use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Json, Path as AxumPath, Query, State,
    },
    http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use base64::Engine;
use serde::Deserialize;
use futures_util::{sink::SinkExt, stream::StreamExt};
use rust_embed::RustEmbed;
use sha2::{Digest, Sha256};
use tokio::sync::{broadcast, RwLock};
use tower_http::{limit::RequestBodyLimitLayer, set_header::SetResponseHeaderLayer};
use tracing::{info, warn};

mod archive;
mod auth;
mod db;
mod ratelimit;
mod sync;

use auth::GoogleVerifier;
use db::{BoardRow, Db, User};
use ratelimit::RateLimiter;
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
    /// Shared per-IP budget for endpoints that create resources or double as
    /// a token-guessing oracle (WS upgrade, board create, lead-token-check,
    /// Google sign-in).
    rate_limiter: RateLimiter,
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

// The y-websocket client tears down and reconnects a socket if it hasn't
// received *any* application-level message in `messageReconnectTimeout`
// (30s, hardcoded in the client lib). An idle board otherwise never sends
// anything, so periodically resending sync step 1 (same as on initial
// connect) keeps the client's timer alive without requiring changes it
// wouldn't otherwise make (it's a no-op if both sides already agree).
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Caps on request/message size, to bound per-request memory use against a
/// client sending an oversized body/frame (a board full of large cards still
/// fits comfortably well under this).
const MAX_HTTP_BODY_BYTES: usize = 5 * 1024 * 1024; // 5 MiB
const MAX_WS_MESSAGE_BYTES: usize = 2 * 1024 * 1024; // 2 MiB
const MAX_WS_FRAME_BYTES: usize = 2 * 1024 * 1024; // 2 MiB

/// Shared per-IP budget for resource-creating / oracle-ish endpoints.
/// Generous enough for a real user reconnecting or switching boards a bunch
/// in a minute; tight enough to sharply slow a scripted flood.
const RATE_LIMIT_MAX_REQUESTS: u32 = 60;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);

/// How often to sweep `state.rooms` for idle, empty rooms so an unbounded
/// stream of connections to fresh slugs doesn't grow memory forever. Safe to
/// evict freely: an evicted room that was genuinely empty has nothing
/// persisted to lose, and `get_or_create_room` transparently recreates it
/// (re-hydrating from the DB, which is a no-op for an empty board) if anyone
/// reconnects afterward.
const ROOM_EVICTION_INTERVAL: Duration = Duration::from_secs(10 * 60);

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

/// A room with no one connected and no content is just a stale in-memory
/// entry — safe to hide from the dashboard and safe to evict.
fn is_stale_room(participant_count: usize, summary: &sync::BoardSummary) -> bool {
    participant_count == 0 && summary.card_count == 0 && summary.label.is_empty()
}

/// Periodically remove idle, empty rooms from memory so an unauthenticated
/// stream of connections to fresh slugs (each one auto-creates a room, see
/// `get_or_create_room`) can't grow the process's memory without bound.
async fn evict_idle_rooms(rooms: Arc<RwLock<HashMap<String, Arc<Room>>>>, sweep_every: Duration) {
    let mut interval = tokio::time::interval(sweep_every);
    interval.tick().await; // skip the immediate first tick
    loop {
        interval.tick().await;
        let mut to_evict = Vec::new();
        for (slug, room) in rooms.read().await.iter() {
            let participant_count = room.clients.read().await.len();
            let summary = {
                let doc = room.doc.lock().unwrap();
                doc.read_summary()
            };
            if is_stale_room(participant_count, &summary) {
                to_evict.push(slug.clone());
            }
        }
        if to_evict.is_empty() {
            continue;
        }
        let mut rooms = rooms.write().await;
        for slug in &to_evict {
            // Re-check under the write lock: someone may have joined since the
            // read-locked scan above.
            let still_stale = match rooms.get(slug) {
                Some(room) => {
                    let participant_count = room.clients.read().await.len();
                    let summary = {
                        let doc = room.doc.lock().unwrap();
                        doc.read_summary()
                    };
                    is_stale_room(participant_count, &summary)
                }
                None => false,
            };
            if still_stale {
                rooms.remove(slug);
            }
        }
        info!("evicted {} idle empty room(s)", to_evict.len());
    }
}

#[derive(Deserialize)]
struct WsQuery {
    board: Option<String>,
}

/// Build the full router: all routes, rate limiting on the
/// resource-creating/oracle-ish ones, body-size limit, and security headers.
/// Pulled out of `main` so tests can exercise it directly with `tower::ServiceExt::oneshot`.
fn build_router(state: AppState) -> Router {
    let rl = axum::middleware::from_fn_with_state(state.clone(), ratelimit::rate_limit);
    Router::new()
        // Rate-limited: creates a resource (a room) or doubles as a
        // token-guessing oracle, per an unauthenticated caller's request alone.
        .route("/ws", get(ws_handler).route_layer(rl.clone()))
        .route(
            "/api/lead-token-check/:token",
            get(lead_token_check).route_layer(rl.clone()),
        )
        .route("/api/auth/google", post(auth_google).route_layer(rl.clone()))
        .route(
            "/api/boards",
            post(create_board).get(list_boards).route_layer(rl),
        )
        .route("/api/health", get(health))
        .route("/api/config", get(config))
        // Accounts (Google SSO)
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/me", get(me))
        .route("/api/me/boards", get(my_boards))
        .route("/api/me/archives", get(my_archives))
        // Per-board host model + admin host-dashboard (global lead token)
        .route("/api/boards/:slug", get(board_status))
        .route("/api/boards/:slug/end", post(end_board))
        .route("/api/boards/:slug/archive", post(create_archive))
        .route("/api/archives", get(list_archives))
        .route("/api/archives/:id", get(get_archive).delete(delete_archive))
        .fallback(static_handler)
        .layer(RequestBodyLimitLayer::new(MAX_HTTP_BODY_BYTES))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            compute_csp(),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .with_state(state)
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
        rate_limiter: RateLimiter::new(RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW),
    };

    tokio::spawn(evict_idle_rooms(state.rooms.clone(), ROOM_EVICTION_INTERVAL));

    println!("=================================================");
    println!("Fast Retro starting");
    println!("Port: {}", port);
    println!("Lead token: {}", lead_token);
    println!("Lead URL path: /lead/{}", lead_token);
    println!("=================================================");

    let app = build_router(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
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
        let summary = {
            let doc = room.doc.lock().unwrap();
            doc.read_summary()
        };
        // Skip rooms with no participants AND no content — they're just stale entries.
        if is_stale_room(participant_count, &summary) {
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
    ws.max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_FRAME_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, room))
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

    // keepalive: periodically resend sync step 1 so idle boards don't churn
    // client reconnects every messageReconnectTimeout (see KEEPALIVE_INTERVAL)
    let keepalive_room = room.clone();
    let keepalive_tx = out_tx.clone();
    let keepalive_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(KEEPALIVE_INTERVAL);
        interval.tick().await; // first tick fires immediately; skip it, we just synced above
        loop {
            interval.tick().await;
            let sv = {
                let doc = keepalive_room.doc.lock().unwrap();
                doc.state_vector()
            };
            let msg = sync::encode_sync_step1(&sv);
            if keepalive_tx.send(Message::Binary(msg)).is_err() {
                break;
            }
        }
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
    keepalive_task.abort();
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
    if !claims.email_verified {
        warn!("google sign-in rejected: unverified email ({})", claims.sub);
        return (StatusCode::UNAUTHORIZED, "Google account email not verified").into_response();
    }
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

/// Build the Content-Security-Policy header value. `script-src` is locked to
/// `'self'` plus Google's GIS script, with the embedded `index.html`'s one
/// inline hydration `<script>` (SvelteKit's static-adapter bootstrap) allowed
/// by hash rather than a blanket `'unsafe-inline'` — the app has no other
/// inline scripts and never injects HTML (`{@html}`/`innerHTML` aren't used
/// anywhere), so nothing else should ever need to execute.
fn compute_csp() -> HeaderValue {
    let script_src = StaticAssets::get("index.html")
        .and_then(|f| String::from_utf8(f.data.into_owned()).ok())
        .and_then(|html| {
            let start = html.find("<script>")? + "<script>".len();
            let end = start + html[start..].find("</script>")?;
            Some(html[start..end].to_string())
        })
        .map(|script_body| {
            let digest = Sha256::digest(script_body.as_bytes());
            let hash = base64::engine::general_purpose::STANDARD.encode(digest);
            format!("'self' 'sha256-{hash}' https://accounts.google.com")
        })
        .unwrap_or_else(|| {
            warn!("couldn't extract inline hydration script for CSP hash; falling back to 'unsafe-inline' for script-src");
            "'self' 'unsafe-inline' https://accounts.google.com".to_string()
        });

    let csp = format!(
        "default-src 'self'; \
         script-src {script_src}; \
         style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: https://*.googleusercontent.com; \
         font-src 'self'; \
         connect-src 'self' ws: wss: https://accounts.google.com; \
         frame-src https://accounts.google.com; \
         object-src 'none'; \
         base-uri 'self'; \
         form-action 'self'; \
         frame-ancestors 'none'"
    );
    HeaderValue::from_str(&csp).unwrap_or_else(|_| HeaderValue::from_static("default-src 'self'"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::extract::connect_info::ConnectInfo;
    use axum::http::Request;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState {
            rooms: Arc::new(RwLock::new(HashMap::new())),
            lead_token: "test-lead-token".to_string(),
            db: Db::open(":memory:").expect("open in-memory db"),
            google: None,
            cookie_secure: true,
            rate_limiter: RateLimiter::new(RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW),
        }
    }

    /// The rate-limit middleware extracts `ConnectInfo<SocketAddr>`, which
    /// `oneshot` doesn't populate the way a real listener would — set it
    /// manually so requests to rate-limited routes don't fail extraction.
    fn with_peer(mut req: Request<Body>) -> Request<Body> {
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 12345))));
        req
    }

    #[tokio::test]
    async fn oversized_body_is_rejected() {
        let app = build_router(test_state());
        let big_body = vec![b'a'; MAX_HTTP_BODY_BYTES + 1];
        let req = with_peer(
            Request::builder()
                .method("POST")
                .uri("/api/boards")
                .header("content-type", "application/json")
                .body(Body::from(big_body))
                .unwrap(),
        );
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn normal_sized_body_is_accepted() {
        let app = build_router(test_state());
        let req = with_peer(
            Request::builder()
                .method("POST")
                .uri("/api/boards")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"slug":"size-test","label":"hi"}"#))
                .unwrap(),
        );
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn rate_limit_allows_up_to_budget_then_blocks() {
        let app = build_router(test_state());

        let mut last_status = StatusCode::OK;
        for _ in 0..RATE_LIMIT_MAX_REQUESTS {
            let req = with_peer(
                Request::builder()
                    .uri("/api/lead-token-check/nope")
                    .body(Body::empty())
                    .unwrap(),
            );
            last_status = app.clone().oneshot(req).await.unwrap().status();
        }
        assert_eq!(
            last_status,
            StatusCode::FORBIDDEN,
            "wrong-token response, but still let through within budget"
        );

        let req = with_peer(
            Request::builder()
                .uri("/api/lead-token-check/nope")
                .body(Body::empty())
                .unwrap(),
        );
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn rate_limit_is_scoped_per_ip() {
        let app = build_router(test_state());
        for _ in 0..RATE_LIMIT_MAX_REQUESTS {
            let req = with_peer(
                Request::builder()
                    .uri("/api/lead-token-check/nope")
                    .body(Body::empty())
                    .unwrap(),
            );
            app.clone().oneshot(req).await.unwrap();
        }

        let mut other_peer = Request::builder()
            .uri("/api/lead-token-check/nope")
            .body(Body::empty())
            .unwrap();
        other_peer
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([10, 0, 0, 1], 1))));
        let res = app.oneshot(other_peer).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "a different IP should have its own budget"
        );
    }

    #[tokio::test]
    async fn security_headers_present() {
        let app = build_router(test_state());
        let req = with_peer(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        );
        let res = app.oneshot(req).await.unwrap();
        let headers = res.headers();
        assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
        assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
        assert_eq!(
            headers.get("referrer-policy").unwrap(),
            "strict-origin-when-cross-origin"
        );
        let csp = headers
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.starts_with("default-src 'self'"));
        assert!(csp.contains("frame-ancestors 'none'"));
        assert!(
            csp.contains("script-src 'self' 'sha256-"),
            "script-src should be locked to a hash, not 'unsafe-inline': {csp}"
        );
    }

    #[test]
    fn stale_room_detection() {
        fn summary(label: &str, card_count: usize) -> sync::BoardSummary {
            sync::BoardSummary {
                label: label.to_string(),
                card_count,
                phase: "brainstorm".to_string(),
                anonymous: false,
            }
        }

        assert!(is_stale_room(0, &summary("", 0)));
        assert!(!is_stale_room(1, &summary("", 0)), "has a participant");
        assert!(!is_stale_room(0, &summary("", 3)), "has cards");
        assert!(!is_stale_room(0, &summary("Sprint 1", 0)), "has a label");
    }

    #[tokio::test]
    async fn idle_empty_rooms_are_evicted() {
        let rooms: Arc<RwLock<HashMap<String, Arc<Room>>>> = Arc::new(RwLock::new(HashMap::new()));
        let db = Db::open(":memory:").unwrap();
        rooms
            .write()
            .await
            .insert("empty-room".to_string(), Room::new("empty-room".to_string(), db));
        assert!(rooms.read().await.contains_key("empty-room"));

        let sweep_interval = Duration::from_millis(20);
        tokio::spawn(evict_idle_rooms(rooms.clone(), sweep_interval));

        tokio::time::sleep(sweep_interval * 4).await;
        assert!(
            !rooms.read().await.contains_key("empty-room"),
            "idle empty room should have been evicted"
        );
    }

    #[tokio::test]
    async fn rooms_with_content_are_not_evicted() {
        let rooms: Arc<RwLock<HashMap<String, Arc<Room>>>> = Arc::new(RwLock::new(HashMap::new()));
        let db = Db::open(":memory:").unwrap();
        let room = Room::new("has-a-client".to_string(), db);
        room.clients
            .write()
            .await
            .insert(1, tokio::sync::mpsc::unbounded_channel().0);
        rooms.write().await.insert("has-a-client".to_string(), room);

        let sweep_interval = Duration::from_millis(20);
        tokio::spawn(evict_idle_rooms(rooms.clone(), sweep_interval));

        tokio::time::sleep(sweep_interval * 4).await;
        assert!(
            rooms.read().await.contains_key("has-a-client"),
            "a room with a connected client should not be evicted"
        );
    }
}
