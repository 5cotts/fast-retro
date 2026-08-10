//! Minimal per-IP fixed-window rate limiter for endpoints that are either
//! unauthenticated-and-resource-creating (WS upgrade, board create) or double
//! as a token-guessing oracle (lead-token-check, Google sign-in).
//!
//! Client IP is read from `X-Forwarded-For` first, falling back to the TCP
//! peer address. This app is documented (README "Deploying") to always run
//! behind a reverse proxy, so the bare peer address alone would just be the
//! proxy's for every client — the deployer's proxy is trusted to set XFF to
//! the real client IP and not pass through an untrusted client-supplied one.

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::AppState;

#[derive(Clone)]
pub struct RateLimiter {
    max_requests: u32,
    window: Duration,
    hits: Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            max_requests,
            window,
            hits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn allow(&self, ip: IpAddr) -> bool {
        let mut hits = self.hits.lock().unwrap();
        let now = Instant::now();
        // Opportunistically bound memory from the ever-growing set of IPs seen.
        if hits.len() > 10_000 {
            hits.retain(|_, (started, _)| now.duration_since(*started) < self.window);
        }
        let entry = hits.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 1);
            return true;
        }
        entry.1 += 1;
        entry.1 <= self.max_requests
    }
}

fn client_ip(headers: &axum::http::HeaderMap, peer: SocketAddr) -> IpAddr {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|xff| xff.split(',').next())
        .and_then(|first| first.trim().parse::<IpAddr>().ok())
        .unwrap_or_else(|| peer.ip())
}

/// Middleware: reject with 429 once the caller's IP exceeds `state.rate_limiter`'s
/// budget. Apply with `.route_layer(...)` only to routes that should share this
/// budget — not the whole router.
pub async fn rate_limit(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let ip = client_ip(req.headers(), peer);
    if !state.rate_limiter.allow(ip) {
        return (StatusCode::TOO_MANY_REQUESTS, "too many requests, slow down").into_response();
    }
    next.run(req).await
}
