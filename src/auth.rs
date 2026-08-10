//! Google Sign-In (GIS) ID-token verification + session cookies.
//!
//! The frontend uses Google Identity Services, which hands us a signed JWT
//! (ID token). We verify it against Google's published JWKS (RS256), check the
//! audience and issuer, and — on success — upsert the user and mint our own
//! session cookie. We never need a Google client secret or the OAuth redirect
//! dance because we only want identity, not API scopes.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

const GOOGLE_CERTS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_SECS: u64 = 3600;
/// Session cookie name.
pub const SESSION_COOKIE: &str = "retro_session";

#[derive(Debug, Clone, Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

/// The claims we care about from a verified Google ID token.
#[derive(Debug, Deserialize)]
pub struct GoogleClaims {
    pub sub: String,
    #[serde(default)]
    pub email: String,
    /// Google's own attestation that `email` has been verified. Defaults to
    /// `true` when absent: GIS tokens for real sign-ins always include it as
    /// `true`, and callers should only ever see `false` for edge-case Google
    /// account types we don't want to silently treat as verified.
    #[serde(default = "default_true")]
    pub email_verified: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub picture: String,
}

fn default_true() -> bool {
    true
}

struct CachedJwks {
    keys: Vec<Jwk>,
    fetched_at: u64,
}

/// Verifies Google ID tokens for a single OAuth client id, caching the JWKS.
pub struct GoogleVerifier {
    client_id: String,
    cache: Mutex<Option<CachedJwks>>,
    http: reqwest::Client,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl GoogleVerifier {
    pub fn new(client_id: String) -> Self {
        Self {
            client_id,
            cache: Mutex::new(None),
            http: reqwest::Client::new(),
        }
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    async fn jwks(&self) -> Result<Vec<Jwk>, String> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some(c) = cache.as_ref() {
                if now_secs().saturating_sub(c.fetched_at) < JWKS_TTL_SECS {
                    return Ok(c.keys.clone());
                }
            }
        }
        let resp = self
            .http
            .get(GOOGLE_CERTS_URL)
            .send()
            .await
            .map_err(|e| format!("fetch JWKS: {e}"))?;
        let jwks: Jwks = resp.json().await.map_err(|e| format!("parse JWKS: {e}"))?;
        let mut cache = self.cache.lock().unwrap();
        *cache = Some(CachedJwks {
            keys: jwks.keys.clone(),
            fetched_at: now_secs(),
        });
        Ok(jwks.keys)
    }

    /// Verify an ID token's signature + claims. Returns the identity on success.
    pub async fn verify(&self, token: &str) -> Result<GoogleClaims, String> {
        let header = decode_header(token).map_err(|e| format!("bad token header: {e}"))?;
        let kid = header.kid.ok_or_else(|| "token missing kid".to_string())?;

        let mut keys = self.jwks().await?;
        // If the kid isn't found, the signing keys may have rotated — force one
        // refresh before giving up.
        if !keys.iter().any(|k| k.kid == kid) {
            self.cache.lock().unwrap().take();
            keys = self.jwks().await?;
        }
        let jwk = keys
            .into_iter()
            .find(|k| k.kid == kid)
            .ok_or_else(|| "no matching signing key".to_string())?;

        let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
            .map_err(|e| format!("build key: {e}"))?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[self.client_id.as_str()]);
        validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);

        let data = decode::<GoogleClaims>(token, &decoding_key, &validation)
            .map_err(|e| format!("verify token: {e}"))?;
        Ok(data.claims)
    }
}

/// Build a `Set-Cookie` header value for the session cookie.
/// `secure` should be true in production (HTTPS); false lets local http testing
/// work.
pub fn session_cookie(token: &str, secure: bool) -> String {
    let max_age = 60 * 60 * 24 * 30; // 30 days
    let mut c = format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
    );
    if secure {
        c.push_str("; Secure");
    }
    c
}

/// Build a `Set-Cookie` value that clears the session cookie.
pub fn clear_cookie(secure: bool) -> String {
    let mut c = format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    if secure {
        c.push_str("; Secure");
    }
    c
}

/// Pull the session token out of a Cookie header, if present.
pub fn session_from_cookies(cookie_header: Option<&str>) -> Option<String> {
    let header = cookie_header?;
    for part in header.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix(&format!("{SESSION_COOKIE}=")) {
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}
