use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use rust_embed::RustEmbed;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

mod sync;

use sync::{Awareness, ClientId, Doc};

#[derive(RustEmbed)]
#[folder = "frontend/build/"]
struct StaticAssets;

type ClientSink = tokio::sync::mpsc::UnboundedSender<Message>;

struct Room {
    doc: Mutex<Doc>,
    awareness: Mutex<Awareness>,
    clients: RwLock<HashMap<ClientId, ClientSink>>,
    broadcast: broadcast::Sender<BroadcastMsg>,
    next_client_id: Mutex<u64>,
}

#[derive(Clone)]
enum BroadcastMsg {
    DocUpdate { from: ClientId, update: Vec<u8> },
    AwarenessUpdate { from: ClientId, update: Vec<u8> },
    ClientGone { client_id: ClientId },
}

impl Room {
    fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(256);
        Arc::new(Self {
            doc: Mutex::new(Doc::new()),
            awareness: Mutex::new(Awareness::new()),
            clients: RwLock::new(HashMap::new()),
            broadcast: tx,
            next_client_id: Mutex::new(1),
        })
    }

    fn next_client_id(&self) -> ClientId {
        let mut id = self.next_client_id.lock().unwrap();
        let v = *id;
        *id += 1;
        v
    }
}

#[derive(Clone)]
struct AppState {
    room: Arc<Room>,
    lead_token: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fast_retro=info,tower_http=info".into()),
        )
        .init();

    let lead_token = std::env::var("RETRO_LEAD_TOKEN").unwrap_or_else(|_| {
        use rand::Rng;
        let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
        let mut rng = rand::thread_rng();
        (0..16).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
    });

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5102);

    let state = AppState {
        room: Room::new(),
        lead_token: lead_token.clone(),
    };

    println!("=================================================");
    println!("Fast Retro starting");
    println!("Port: {}", port);
    println!("Lead token: {}", lead_token);
    println!("Lead URL path: /lead/{}", lead_token);
    println!("=================================================");

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/health", get(health))
        .route("/api/lead-token-check/:token", get(lead_token_check))
        .fallback(static_handler)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}

async fn lead_token_check(
    State(state): State<AppState>,
    axum::extract::Path(token): axum::extract::Path<String>,
) -> Response {
    if token == state.lead_token {
        (StatusCode::OK, "ok").into_response()
    } else {
        (StatusCode::FORBIDDEN, "no").into_response()
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state.room.clone()))
}

async fn handle_socket(socket: WebSocket, room: Arc<Room>) {
    let client_id = room.next_client_id();
    info!("client {} connected", client_id);

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    room.clients.write().await.insert(client_id, out_tx.clone());

    let mut bcast_rx = room.broadcast.subscribe();

    // Send initial sync step 1 to client (request their state)
    {
        let doc = room.doc.lock().unwrap();
        let sv = doc.state_vector();
        let msg = sync::encode_sync_step1(&sv);
        let _ = out_tx.send(Message::Binary(msg));

        // Also send our current state as sync step 2
        let update = doc.encode_state_as_update_v1(&[]);
        let msg = sync::encode_sync_step2(&update);
        let _ = out_tx.send(Message::Binary(msg));

        // Send current awareness
        let aw = room.awareness.lock().unwrap();
        if let Some(full) = aw.encode_full() {
            let msg = sync::encode_awareness(&full);
            let _ = out_tx.send(Message::Binary(msg));
        }
    }

    // outbound: pump from mpsc to ws
    let outbound = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
        let _ = ws_tx.close().await;
    });

    // broadcast: forward broadcasts to this client (except own messages)
    let bcast_tx = out_tx.clone();
    let bcast_task = tokio::spawn(async move {
        while let Ok(msg) = bcast_rx.recv().await {
            match msg {
                BroadcastMsg::DocUpdate { from, update } => {
                    if from != client_id {
                        let m = sync::encode_sync_update(&update);
                        if bcast_tx.send(Message::Binary(m)).is_err() {
                            break;
                        }
                    }
                }
                BroadcastMsg::AwarenessUpdate { from, update } => {
                    if from != client_id {
                        let m = sync::encode_awareness(&update);
                        if bcast_tx.send(Message::Binary(m)).is_err() {
                            break;
                        }
                    }
                }
                BroadcastMsg::ClientGone { client_id: gone } => {
                    if gone != client_id {
                        // already encoded as awareness null entry by sender side
                        let _ = gone;
                    }
                }
            }
        }
    });

    // inbound: handle messages from this client
    while let Some(msg) = ws_rx.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };
        match msg {
            Message::Binary(data) => {
                if let Err(e) = process_message(&room, client_id, &data, &out_tx).await {
                    warn!("client {} message error: {}", client_id, e);
                }
            }
            Message::Text(_) => {}
            Message::Ping(_) | Message::Pong(_) => {}
            Message::Close(_) => break,
        }
    }

    info!("client {} disconnected", client_id);
    room.clients.write().await.remove(&client_id);

    // remove from awareness, broadcast removal
    let removal = {
        let mut aw = room.awareness.lock().unwrap();
        aw.remove_client(client_id)
    };
    if let Some(update) = removal {
        let _ = room.broadcast.send(BroadcastMsg::AwarenessUpdate {
            from: 0, // 0 means "from server", everyone receives
            update,
        });
    }

    bcast_task.abort();
    outbound.abort();
}

async fn process_message(
    room: &Arc<Room>,
    client_id: ClientId,
    data: &[u8],
    out_tx: &ClientSink,
) -> Result<(), String> {
    let mut cursor = sync::Cursor::new(data);

    // y-protocol can have multiple messages concatenated; loop until done
    while cursor.remaining() > 0 {
        let msg_type = cursor.read_var_uint().map_err(|e| e.to_string())?;
        match msg_type {
            0 => {
                // sync message
                let sync_type = cursor.read_var_uint().map_err(|e| e.to_string())?;
                let payload = cursor.read_var_bytes().map_err(|e| e.to_string())?;
                match sync_type {
                    0 => {
                        // SyncStep1: peer sends their state vector, we respond with our diff
                        let update = {
                            let doc = room.doc.lock().unwrap();
                            doc.encode_state_as_update_v1(payload)
                        };
                        let reply = sync::encode_sync_step2(&update);
                        let _ = out_tx.send(Message::Binary(reply));
                    }
                    1 | 2 => {
                        // SyncStep2 or Update: apply to our doc, broadcast
                        let applied = {
                            let mut doc = room.doc.lock().unwrap();
                            doc.apply_update_v1(payload).map_err(|e| e.to_string())?
                        };
                        if !applied.is_empty() {
                            let _ = room.broadcast.send(BroadcastMsg::DocUpdate {
                                from: client_id,
                                update: applied,
                            });
                        }
                    }
                    _ => {}
                }
            }
            1 => {
                // awareness message
                let payload = cursor.read_var_bytes().map_err(|e| e.to_string())?;
                let applied = {
                    let mut aw = room.awareness.lock().unwrap();
                    aw.apply_update(payload).map_err(|e| e.to_string())?
                };
                if let Some(update) = applied {
                    let _ = room.broadcast.send(BroadcastMsg::AwarenessUpdate {
                        from: client_id,
                        update,
                    });
                }
            }
            _ => {
                // unknown message type — skip remainder
                break;
            }
        }
    }
    Ok(())
}

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    // SPA routing: serve index.html for unknown routes (no file extension)
    let try_path = if path.is_empty() {
        "index.html".to_string()
    } else {
        path.to_string()
    };

    if let Some(asset) = StaticAssets::get(&try_path) {
        let mime = mime_guess::from_path(&try_path).first_or_octet_stream();
        return Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, "no-cache")
            .body(axum::body::Body::from(asset.data.into_owned()))
            .unwrap();
    }

    // SPA fallback to index.html for paths without a file extension
    if !try_path.contains('.') {
        if let Some(asset) = StaticAssets::get("index.html") {
            return Response::builder()
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(axum::body::Body::from(asset.data.into_owned()))
                .unwrap();
        }
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}
