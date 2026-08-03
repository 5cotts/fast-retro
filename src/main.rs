use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Json, Path as AxumPath, Query, State,
    },
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use futures_util::{sink::SinkExt, stream::StreamExt};
use rust_embed::RustEmbed;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

mod archive;
mod auth;
mod db;
mod sync;

use auth::GoogleVerifier;
use db::{BoardRow, Db, User};
use sync::{Awareness, ClientId, Doc};

#[derive(RustEmbed)]
#[folder = "frontend/build/"]
struct StaticAssets;

type ClientSink = tokio::sync::mpsc::UnboundedSender<Message>;

struct Room {
    slug: String,
    db: Db,
    doc: Mutex<Doc>,
    awareness: Mutex<Awareness>,
    clients: RwLock<HashMap<ClientId, ClientSink>>,
    broadcast: broadcast::Sender<BroadcastMsg>,
    next_client_id: Mutex<u64>,
    /// Updates appended to the log since the last compaction.
    dirty: AtomicU64,
    /// Board has been ended by its host — read-only, rejects further writes.
    ended: AtomicBool,
}

#[derive(Clone)]
enum BroadcastMsg {
    DocUpdate { from: ClientId, update: Vec<u8> },
    AwarenessUpdate { from: ClientId, update: Vec<u8> },
}

impl Room {
    /// Build a room for `slug`, hydrating its CRDT doc from the database
    /// (compacted snapshot + replayed update log). A brand-new board starts empty.
    fn new(slug: String, db: Db) -> Arc<Self> {
        let (tx, _) = broadcast::channel(256);
        let mut doc = Doc::new();
        for update in db.load_doc(&slug) {
            if let Err(e) = doc.apply_update_v1(&update) {
                warn!("hydrate {} skipped a bad update: {}", slug, e);
            }
        }
        // A board that was already ended stays read-only after a restart.
        let ended = db
            .get_board(&slug)
            .map(|b| b.ended_at.is_some())
            .unwrap_or(false);
        Arc::new(Self {
            slug,
            db,
            doc: Mutex::new(doc),
            awareness: Mutex::new(Awareness::new()),
            clients: RwLock::new(HashMap::new()),
            broadcast: tx,
            next_client_id: Mutex::new(1),
            dirty: AtomicU64::new(0),
            ended: AtomicBool::new(ended),
        })
    }

    fn is_ended(&self) -> bool {
        self.ended.load(Ordering::Relaxed)
    }

    fn next_client_id(&self) -> ClientId {
        let mut id = self.next_client_id.lock().unwrap();
        let v = *id;
        *id += 1;
        v
    }

    /// Persist an applied update to the log, and compact if the log has grown
    /// past the threshold.
    fn persist_update(&self, update: &[u8]) {
        self.db.append_update(&self.slug, update);
        if self.dirty.fetch_add(1, Ordering::Relaxed) + 1 >= db::COMPACT_THRESHOLD {
            self.compact();
        }
    }

    /// Fold the update log into a fresh snapshot. Holds the doc lock across the
    /// snapshot + DB swap so no un-snapshotted update is ever deleted from the log.
    fn compact(&self) {
        let doc = self.doc.lock().unwrap();
        let snapshot = doc.encode_state_as_update_v1(&[]);
        self.db.compact(&self.slug, &snapshot);
        self.dirty.store(0, Ordering::Relaxed);
    }
}

#[derive(Clone)]
struct AppState {
    rooms: Arc<RwLock<HashMap<String, Arc<Room>>>>,
    lead_token: String,
    db: Db,
    /// Google ID-token verifier; None when GOOGLE_CLIENT_ID isn't configured
    /// (SSO simply stays off and the sign-in button is hidden).
    google: Option<Arc<GoogleVerifier>>,
    /// Mark session cookies Secure (production HTTPS). Off for local http tests.
    cookie_secure: bool,
}

impl AppState {
    /// The signed-in user behind the request's session cookie, if any.
    fn session_user(&self, headers: &HeaderMap) -> Option<User> {
        let cookie = headers.get(header::COOKIE).and_then(|v| v.to_str().ok());
        let token = auth::session_from_cookies(cookie)?;
        self.db.user_for_session(&token)
    }

    /// Is the caller authorized to host `slug`? True if they're the signed-in
    /// creator, presented the board host key (`X-Host-Key`), or hold the global
    /// admin lead token.
    fn is_host(&self, slug: &str, headers: &HeaderMap) -> bool {
        if check_lead_token(headers, &self.lead_token) {
            return true;
        }
        let user = self.session_user(headers);
        let host_key = headers.get("x-host-key").and_then(|v| v.to_str().ok());
        self.db
            .is_host(slug, user.as_ref().map(|u| u.id.as_str()), host_key)
    }
}

const DEFAULT_BOARD_SLUG: &str = "default";

fn sanitize_slug(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return None;
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return None;
    }
    Some(trimmed.to_ascii_lowercase())
}

async fn get_or_create_room(state: &AppState, slug: &str) -> Arc<Room> {
    if let Some(room) = state.rooms.read().await.get(slug) {
        return room.clone();
    }
    let mut rooms = state.rooms.write().await;
    // Re-check under the write lock: another task may have created it while we
    // waited (hydration below is not idempotent-cheap enough to race).
    if let Some(room) = rooms.get(slug) {
        return room.clone();
    }
    let room = Room::new(slug.to_string(), state.db.clone());
    rooms.insert(slug.to_string(), room.clone());
    room
}

#[derive(Deserialize)]
struct WsQuery {
    board: Option<String>,
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

    let db_path = std::env::var("FASTRETRO_DB").unwrap_or_else(|_| "data/fastretro.db".to_string());
    let db = Db::open(&db_path).unwrap_or_else(|e| {
        panic!("failed to open database at {}: {}", db_path, e);
    });
    info!("database: {}", db_path);

    match archive::migrate_from_json(&db) {
        Ok(0) => {}
        Ok(n) => info!("imported {} archive(s) from data/archives/*.json into the DB", n),
        Err(e) => warn!("archive JSON migration failed: {}", e),
    }

    let google = match std::env::var("GOOGLE_CLIENT_ID") {
        Ok(id) if !id.trim().is_empty() => {
            info!("Google SSO enabled (client id ...{})", &id[id.len().saturating_sub(12)..]);
            Some(Arc::new(GoogleVerifier::new(id.trim().to_string())))
        }
        _ => {
            info!("Google SSO disabled (set GOOGLE_CLIENT_ID to enable)");
            None
        }
    };

    // Cookies default to Secure; set COOKIE_SECURE=0 for local http testing.
    let cookie_secure = std::env::var("COOKIE_SECURE")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true);

    let state = AppState {
        rooms: Arc::new(RwLock::new(HashMap::new())),
        lead_token: lead_token.clone(),
        db,
        google,
        cookie_secure,
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
        .route("/api/config", get(config))
        .route("/api/lead-token-check/:token", get(lead_token_check))
        // Accounts (Google SSO)
        .route("/api/auth/google", post(auth_google))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/me", get(me))
        .route("/api/me/boards", get(my_boards))
        .route("/api/me/archives", get(my_archives))
        // Per-board host model + admin host-dashboard (global lead token)
        .route("/api/boards", post(create_board).get(list_boards))
        .route("/api/boards/:slug", get(board_status))
        .route("/api/boards/:slug/end", post(end_board))
        .route("/api/boards/:slug/archive", post(create_archive))
        .route("/api/archives", get(list_archives))
        .route("/api/archives/:id", get(get_archive).delete(delete_archive))
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveBoardSummary {
    slug: String,
    label: String,
    card_count: usize,
    phase: String,
    anonymous: bool,
    participant_count: usize,
}

async fn list_boards(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !check_lead_token(&headers, &state.lead_token) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let rooms = state.rooms.read().await;
    let mut out: Vec<LiveBoardSummary> = Vec::with_capacity(rooms.len());
    for (slug, room) in rooms.iter() {
        let participant_count = room.clients.read().await.len();
        // Skip rooms with no participants AND no content — they're just stale entries.
        let summary = {
            let doc = room.doc.lock().unwrap();
            doc.read_summary()
        };
        if participant_count == 0 && summary.card_count == 0 && summary.label.is_empty() {
            continue;
        }
        out.push(LiveBoardSummary {
            slug: slug.clone(),
            label: summary.label,
            card_count: summary.card_count,
            phase: summary.phase,
            anonymous: summary.anonymous,
            participant_count,
        });
    }
    out.sort_by(|a, b| {
        b.participant_count
            .cmp(&a.participant_count)
            .then_with(|| b.card_count.cmp(&a.card_count))
            .then_with(|| a.slug.cmp(&b.slug))
    });
    (StatusCode::OK, Json(out)).into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<AppState>,
) -> Response {
    let slug = query
        .board
        .as_deref()
        .and_then(sanitize_slug)
        .unwrap_or_else(|| DEFAULT_BOARD_SLUG.to_string());
    let room = get_or_create_room(&state, &slug).await;
    ws.on_upgrade(move |socket| handle_socket(socket, room))
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
    let remaining = {
        let mut clients = room.clients.write().await;
        clients.remove(&client_id);
        clients.len()
    };
    // When the last participant leaves, fold the update log into a snapshot so
    // the board is stored compactly and is ready to survive a restart.
    if remaining == 0 {
        room.compact();
    }

    // We don't proactively broadcast awareness removal: frontends publish a
    // final "null" awareness state on unload, and the y-protocols client-side
    // timeout sweeps stragglers. See Awareness::apply_update in sync.rs.

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
                        // SyncStep2 or Update: apply to our doc, broadcast.
                        // Ended boards are read-only — silently drop writes so a
                        // stale client can't mutate an archived retro.
                        if room.is_ended() {
                            continue;
                        }
                        let applied = {
                            let mut doc = room.doc.lock().unwrap();
                            doc.apply_update_v1(payload).map_err(|e| e.to_string())?
                        };
                        if !applied.is_empty() {
                            room.persist_update(&applied);
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

fn check_lead_token(headers: &HeaderMap, expected: &str) -> bool {
    let Some(auth) = headers.get(header::AUTHORIZATION) else {
        return false;
    };
    let Ok(s) = auth.to_str() else {
        return false;
    };
    let token = s.strip_prefix("Bearer ").unwrap_or(s);
    // Constant-time compare to avoid token oracle.
    let a = token.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn config(State(state): State<AppState>) -> Response {
    let (enabled, client_id) = match &state.google {
        Some(v) => (true, v.client_id().to_string()),
        None => (false, String::new()),
    };
    Json(serde_json::json!({ "googleEnabled": enabled, "googleClientId": client_id })).into_response()
}

#[derive(Deserialize)]
struct GoogleAuthReq {
    credential: String,
}

async fn auth_google(
    State(state): State<AppState>,
    Json(req): Json<GoogleAuthReq>,
) -> Response {
    let Some(verifier) = state.google.as_ref() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Google SSO not configured").into_response();
    };
    let claims = match verifier.verify(&req.credential).await {
        Ok(c) => c,
        Err(e) => {
            warn!("google token verify failed: {}", e);
            return (StatusCode::UNAUTHORIZED, "invalid Google token").into_response();
        }
    };
    let user = match state
        .db
        .upsert_user(&claims.sub, &claims.email, &claims.name, &claims.picture)
    {
        Ok(u) => u,
        Err(e) => {
            warn!("upsert_user failed: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "sign-in failed").into_response();
        }
    };
    let token = match state.db.create_session(&user.id) {
        Ok(t) => t,
        Err(e) => {
            warn!("create_session failed: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "sign-in failed").into_response();
        }
    };
    let cookie = auth::session_cookie(&token, state.cookie_secure);
    (
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({ "user": user })),
    )
        .into_response()
}

async fn auth_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let cookie = headers.get(header::COOKIE).and_then(|v| v.to_str().ok());
    if let Some(token) = auth::session_from_cookies(cookie) {
        state.db.delete_session(&token);
    }
    (
        [(header::SET_COOKIE, auth::clear_cookie(state.cookie_secure))],
        Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = state.session_user(&headers);
    Json(serde_json::json!({ "user": user })).into_response()
}

async fn my_boards(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(user) = state.session_user(&headers) else {
        return (StatusCode::UNAUTHORIZED, "not signed in").into_response();
    };
    match state.db.list_boards_for_user(&user.id) {
        Ok(boards) => {
            let out: Vec<_> = boards.iter().map(|b| board_summary_json(b, &user.id)).collect();
            Json(out).into_response()
        }
        Err(e) => {
            warn!("list_boards_for_user failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "failed").into_response()
        }
    }
}

async fn my_archives(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(user) = state.session_user(&headers) else {
        return (StatusCode::UNAUTHORIZED, "not signed in").into_response();
    };
    match state.db.list_archives_for_user(&user.id) {
        Ok(items) => Json(items).into_response(),
        Err(e) => {
            warn!("list_archives_for_user failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "failed").into_response()
        }
    }
}

fn board_summary_json(b: &BoardRow, user_id: &str) -> serde_json::Value {
    serde_json::json!({
        "slug": b.slug,
        "label": b.label,
        "ended": b.ended_at.is_some(),
        "createdAt": b.created_at,
        "isOwner": b.created_by.as_deref() == Some(user_id),
    })
}

#[derive(Deserialize)]
struct CreateBoardReq {
    #[serde(default)]
    slug: String,
    #[serde(default)]
    label: String,
}

async fn create_board(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateBoardReq>,
) -> Response {
    let Some(slug) = sanitize_slug(&req.slug) else {
        return (StatusCode::BAD_REQUEST, "bad slug").into_response();
    };
    let label = req.label.trim().chars().take(60).collect::<String>();
    let user = state.session_user(&headers);
    let created_by = user.as_ref().map(|u| u.id.as_str());
    match state.db.create_board(&slug, &label, created_by) {
        Ok(Some(host_key)) => {
            if let Some(uid) = created_by {
                state.db.upsert_participant(&slug, uid);
            }
            Json(serde_json::json!({ "slug": slug, "hostKey": host_key })).into_response()
        }
        Ok(None) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "slug taken" })),
        )
            .into_response(),
        Err(e) => {
            warn!("create_board failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "create failed").into_response()
        }
    }
}

async fn board_status(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    let Some(slug) = sanitize_slug(&slug) else {
        return (StatusCode::BAD_REQUEST, "bad slug").into_response();
    };
    let board = state.db.get_board(&slug);
    let exists = board.is_some();
    let ended = board.as_ref().map(|b| b.ended_at.is_some()).unwrap_or(false);
    let label = board.as_ref().map(|b| b.label.clone()).unwrap_or_default();
    let am_host = state.is_host(&slug, &headers);
    // A signed-in visitor to an existing board counts as a participant (powers
    // "My retros"). Idempotent.
    if exists {
        if let Some(user) = state.session_user(&headers) {
            state.db.upsert_participant(&slug, &user.id);
        }
    }
    Json(serde_json::json!({
        "slug": slug,
        "exists": exists,
        "ended": ended,
        "label": label,
        "amHost": am_host,
    }))
    .into_response()
}

async fn end_board(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: HeaderMap,
    Json(req): Json<archive::ArchiveRequest>,
) -> Response {
    let Some(slug) = sanitize_slug(&slug) else {
        return (StatusCode::BAD_REQUEST, "bad slug").into_response();
    };
    if !state.is_host(&slug, &headers) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let user = state.session_user(&headers);
    let created_by = user.as_ref().map(|u| u.id.as_str());
    let label = req.label.clone();
    let archive = match archive::save(&state.db, &slug, req, created_by) {
        Ok(a) => a,
        Err(e) => {
            warn!("end_board archive failed: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "archive failed").into_response();
        }
    };
    state.db.end_board(&slug);
    if !label.is_empty() {
        state.db.set_board_label(&slug, &label);
    }
    // Flip the live room to read-only and snapshot its final state.
    if let Some(room) = state.rooms.read().await.get(&slug) {
        room.ended.store(true, Ordering::Relaxed);
        room.compact();
    }
    Json(serde_json::json!({ "archiveId": archive.id })).into_response()
}

async fn create_archive(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    headers: HeaderMap,
    Json(req): Json<archive::ArchiveRequest>,
) -> Response {
    if !check_lead_token(&headers, &state.lead_token) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let Some(slug) = sanitize_slug(&slug) else {
        return (StatusCode::BAD_REQUEST, "bad slug").into_response();
    };
    let created_by = state.session_user(&headers).map(|u| u.id);
    match archive::save(&state.db, &slug, req, created_by.as_deref()) {
        Ok(a) => (StatusCode::OK, Json(serde_json::json!({ "id": a.id }))).into_response(),
        Err(e) => {
            warn!("archive save failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "save failed").into_response()
        }
    }
}

async fn list_archives(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !check_lead_token(&headers, &state.lead_token) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    match archive::list(&state.db) {
        Ok(items) => (StatusCode::OK, Json(items)).into_response(),
        Err(e) => {
            warn!("archive list failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "list failed").into_response()
        }
    }
}

async fn get_archive(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !check_lead_token(&headers, &state.lead_token) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    match archive::load(&state.db, &id) {
        Ok(Some(a)) => (StatusCode::OK, Json(a)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, "not found").into_response(),
        Err(e) => {
            warn!("archive load failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "load failed").into_response()
        }
    }
}

async fn delete_archive(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !check_lead_token(&headers, &state.lead_token) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    match archive::delete(&state.db, &id) {
        Ok(true) => (StatusCode::OK, "ok").into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, "not found").into_response(),
        Err(e) => {
            warn!("archive delete failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "delete failed").into_response()
        }
    }
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
