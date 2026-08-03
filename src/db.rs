//! SQLite persistence for fast-retro.
//!
//! Phase 1: durable live boards. The CRDT `Doc` for each board is persisted as
//! a compacted snapshot in `board_docs` plus an append-only log of raw updates
//! in `doc_updates`. On room creation we hydrate from the snapshot and replay
//! the log; on shutdown/idle we compact. A restart therefore restores every
//! board exactly as it was.
//!
//! Phase 2 (this module also handles): archives move from flat JSON files into
//! the `archives` table. The full `Archive` is stored as a JSON blob (same
//! shape the frontend already expects) alongside indexed `slug`/`ended_at`
//! columns for listing. A one-time migration imports any pre-existing
//! `data/archives/*.json` files; the JSON files are left on disk as a backup.
//!
//! The schema also declares the tables later phases (users, sessions,
//! participants) will use, so those migrations are a no-op when we get there.

use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::archive::{Archive, ArchiveSummary};

/// SHA-256 hex of a high-entropy secret (session token / board host key). These
/// are random 256-bit tokens, not user passwords, so a fast hash is fine — it
/// just keeps the raw secret out of the DB.
pub fn hash_secret(secret: &str) -> String {
    let mut h = Sha256::new();
    h.update(secret.as_bytes());
    let digest = h.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// A random URL-safe token (base64url, no padding) for session tokens and board
/// host keys.
pub fn random_token() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_id() -> String {
    use rand::Rng;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    let mut rng = rand::thread_rng();
    (0..16).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

const SESSION_TTL_MS: i64 = 1000 * 60 * 60 * 24 * 30; // 30 days

/// A signed-in user, as stored in `users`.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub google_sub: String,
    pub email: String,
    pub name: String,
    pub avatar_url: String,
}

/// A board row (metadata, not the CRDT doc).
#[derive(Clone)]
pub struct BoardRow {
    pub slug: String,
    pub label: String,
    pub created_by: Option<String>,
    pub host_key_hash: Option<String>,
    pub ended_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

/// Compact a board's update log into a fresh snapshot once it grows past this
/// many pending updates, so `doc_updates` can't grow without bound mid-session.
pub const COMPACT_THRESHOLD: u64 = 200;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS board_docs (
    slug       TEXT PRIMARY KEY,
    ydoc       BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL,
    update_bin BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_updates_slug ON doc_updates(slug, id);

CREATE TABLE IF NOT EXISTS archives (
    id         TEXT PRIMARY KEY,
    slug       TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    ended_at   INTEGER NOT NULL,
    created_by TEXT,
    snapshot   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archives_ended_at ON archives(ended_at);

-- Declared now for later phases; not yet written to.
CREATE TABLE IF NOT EXISTS boards (
    slug           TEXT PRIMARY KEY,
    label          TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL DEFAULT 0,
    created_by     TEXT,
    host_key_hash  TEXT,
    ended_at       INTEGER,
    last_active_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email      TEXT,
    name       TEXT,
    avatar_url TEXT,
    created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
    board_slug    TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (board_slug, user_id)
);
"#;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Db {
    /// Open (creating if needed) the SQLite database at `path`, run migrations,
    /// and return a cloneable handle.
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        // Additive migrations for DBs created before these columns existed.
        // "duplicate column name" just means the migration already ran.
        for stmt in [
            "ALTER TABLE boards ADD COLUMN host_key_hash TEXT",
            "ALTER TABLE boards ADD COLUMN ended_at INTEGER",
        ] {
            if let Err(e) = conn.execute(stmt, []) {
                if !e.to_string().contains("duplicate column name") {
                    tracing::warn!("migration `{}` failed: {}", stmt, e);
                }
            }
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Load a board's persisted state for hydration: the compacted snapshot (if
    /// any) followed by every logged update, in application order. The caller
    /// applies each blob to a fresh `Doc`. Returns an empty vec for an unknown
    /// board (first time it's opened).
    pub fn load_doc(&self, slug: &str) -> Vec<Vec<u8>> {
        let conn = self.conn.lock().unwrap();
        let mut out: Vec<Vec<u8>> = Vec::new();

        let snapshot: Option<Vec<u8>> = conn
            .query_row(
                "SELECT ydoc FROM board_docs WHERE slug = ?1",
                params![slug],
                |row| row.get(0),
            )
            .optional()
            .unwrap_or(None);
        if let Some(snap) = snapshot {
            out.push(snap);
        }

        if let Ok(mut stmt) =
            conn.prepare("SELECT update_bin FROM doc_updates WHERE slug = ?1 ORDER BY id ASC")
        {
            if let Ok(rows) = stmt.query_map(params![slug], |row| row.get::<_, Vec<u8>>(0)) {
                for r in rows.flatten() {
                    out.push(r);
                }
            }
        }
        out
    }

    /// Append a raw CRDT update to the log. Cheap, append-only. Errors are logged
    /// and swallowed so a transient DB hiccup never drops a live client.
    pub fn append_update(&self, slug: &str, update: &[u8]) {
        let conn = self.conn.lock().unwrap();
        if let Err(e) = conn.execute(
            "INSERT INTO doc_updates (slug, update_bin, created_at) VALUES (?1, ?2, ?3)",
            params![slug, update, now_ms()],
        ) {
            tracing::warn!("db append_update failed for {}: {}", slug, e);
        }
    }

    /// Replace a board's log with a single compacted snapshot, atomically. The
    /// caller must hold the room's doc lock while producing `snapshot` so no
    /// update that isn't reflected in the snapshot can be deleted from the log.
    pub fn compact(&self, slug: &str, snapshot: &[u8]) {
        let mut conn = self.conn.lock().unwrap();
        let tx = match conn.transaction() {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("db compact begin failed for {}: {}", slug, e);
                return;
            }
        };
        let res = (|| -> rusqlite::Result<()> {
            tx.execute(
                "INSERT INTO board_docs (slug, ydoc, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(slug) DO UPDATE SET ydoc = excluded.ydoc, updated_at = excluded.updated_at",
                params![slug, snapshot, now_ms()],
            )?;
            tx.execute("DELETE FROM doc_updates WHERE slug = ?1", params![slug])?;
            Ok(())
        })();
        match res {
            Ok(()) => {
                if let Err(e) = tx.commit() {
                    tracing::warn!("db compact commit failed for {}: {}", slug, e);
                }
            }
            Err(e) => tracing::warn!("db compact failed for {}: {}", slug, e),
        }
    }

    // ---------- archives ----------

    /// Insert (or overwrite) an archive row. The whole `Archive` is stored as a
    /// JSON blob in `snapshot`; `slug`/`label`/`ended_at` are duplicated into
    /// their own columns purely so `list_archives` can sort/filter without
    /// deserializing every row.
    pub fn save_archive(&self, archive: &Archive, created_by: Option<&str>) -> rusqlite::Result<()> {
        let snapshot = serde_json::to_string(archive)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO archives (id, slug, label, ended_at, created_by, snapshot)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, label = excluded.label,
                 ended_at = excluded.ended_at, created_by = excluded.created_by,
                 snapshot = excluded.snapshot",
            params![archive.id, archive.slug, archive.label, archive.ended_at, created_by, snapshot],
        )?;
        Ok(())
    }

    /// True if an archive with this id is already stored (used by the JSON
    /// migration to skip files that were already imported).
    pub fn archive_exists(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM archives WHERE id = ?1",
            params![id],
            |_| Ok(()),
        )
        .optional()
        .unwrap_or(None)
        .is_some()
    }

    /// All archives, newest first, for the summary list view.
    pub fn list_archives(&self) -> rusqlite::Result<Vec<Archive>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT snapshot FROM archives ORDER BY ended_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            let json = r?;
            match serde_json::from_str::<Archive>(&json) {
                Ok(a) => out.push(a),
                Err(e) => tracing::warn!("skipping corrupt archive row: {}", e),
            }
        }
        Ok(out)
    }

    pub fn load_archive(&self, id: &str) -> rusqlite::Result<Option<Archive>> {
        let conn = self.conn.lock().unwrap();
        let json: Option<String> = conn
            .query_row(
                "SELECT snapshot FROM archives WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
    }

    /// Returns true if a row was deleted.
    pub fn delete_archive(&self, id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM archives WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// Archives created by a given signed-in user, newest first.
    pub fn list_archives_for_user(&self, user_id: &str) -> rusqlite::Result<Vec<ArchiveSummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT snapshot FROM archives WHERE created_by = ?1 ORDER BY ended_at DESC")?;
        let rows = stmt.query_map(params![user_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            if let Ok(a) = serde_json::from_str::<Archive>(&r?) {
                out.push(a.summary());
            }
        }
        Ok(out)
    }

    // ---------- users & sessions ----------

    /// Insert or update a user keyed on their Google `sub`, returning the row
    /// (with its stable internal id).
    pub fn upsert_user(
        &self,
        google_sub: &str,
        email: &str,
        name: &str,
        avatar_url: &str,
    ) -> rusqlite::Result<User> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE google_sub = ?1",
                params![google_sub],
                |row| row.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE users SET email = ?2, name = ?3, avatar_url = ?4 WHERE id = ?1",
                    params![id, email, name, avatar_url],
                )?;
                id
            }
            None => {
                let id = random_id();
                conn.execute(
                    "INSERT INTO users (id, google_sub, email, name, avatar_url, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![id, google_sub, email, name, avatar_url, now_ms()],
                )?;
                id
            }
        };
        Ok(User {
            id,
            google_sub: google_sub.to_string(),
            email: email.to_string(),
            name: name.to_string(),
            avatar_url: avatar_url.to_string(),
        })
    }

    /// Create a session for a user, returning the raw token (only the hash is
    /// stored).
    pub fn create_session(&self, user_id: &str) -> rusqlite::Result<String> {
        let token = random_token();
        let now = now_ms();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![hash_secret(&token), user_id, now, now + SESSION_TTL_MS],
        )?;
        Ok(token)
    }

    /// Resolve the user behind a raw session token, if the session exists and
    /// hasn't expired.
    pub fn user_for_session(&self, token: &str) -> Option<User> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT u.id, u.google_sub, u.email, u.name, u.avatar_url
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ?1 AND s.expires_at > ?2",
            params![hash_secret(token), now_ms()],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    google_sub: row.get(1)?,
                    email: row.get(2)?,
                    name: row.get(3)?,
                    avatar_url: row.get(4)?,
                })
            },
        )
        .optional()
        .unwrap_or(None)
    }

    pub fn delete_session(&self, token: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM sessions WHERE token_hash = ?1",
            params![hash_secret(token)],
        );
    }

    // ---------- boards ----------

    /// Create a board row and return its raw host key (only the hash is stored).
    /// `created_by` is the signed-in user's id, if any.
    /// Create a board row and return its raw host key, or `None` if the slug is
    /// already taken (caller should retry with a different slug).
    pub fn create_board(
        &self,
        slug: &str,
        label: &str,
        created_by: Option<&str>,
    ) -> rusqlite::Result<Option<String>> {
        let host_key = random_token();
        let now = now_ms();
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "INSERT INTO boards (slug, label, created_at, created_by, host_key_hash, last_active_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?3)
             ON CONFLICT(slug) DO NOTHING",
            params![slug, label, now, created_by, hash_secret(&host_key)],
        )?;
        Ok(if changed > 0 { Some(host_key) } else { None })
    }

    pub fn get_board(&self, slug: &str) -> Option<BoardRow> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT slug, label, created_by, host_key_hash, ended_at, created_at
             FROM boards WHERE slug = ?1",
            params![slug],
            |row| {
                Ok(BoardRow {
                    slug: row.get(0)?,
                    label: row.get(1)?,
                    created_by: row.get(2)?,
                    host_key_hash: row.get(3)?,
                    ended_at: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .optional()
        .unwrap_or(None)
    }

    /// Is the caller the host of this board? True if they're the signed-in
    /// creator, or they presented the matching board host key.
    pub fn is_host(&self, slug: &str, user_id: Option<&str>, host_key: Option<&str>) -> bool {
        let Some(board) = self.get_board(slug) else {
            return false;
        };
        if let (Some(uid), Some(creator)) = (user_id, board.created_by.as_deref()) {
            if uid == creator {
                return true;
            }
        }
        if let (Some(key), Some(hash)) = (host_key, board.host_key_hash.as_deref()) {
            if hash_secret(key) == hash {
                return true;
            }
        }
        false
    }

    /// Mark a board ended (read-only). Returns false if the board doesn't exist.
    pub fn end_board(&self, slug: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE boards SET ended_at = ?2 WHERE slug = ?1 AND ended_at IS NULL",
            params![slug, now_ms()],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    pub fn set_board_label(&self, slug: &str, label: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "UPDATE boards SET label = ?2 WHERE slug = ?1",
            params![slug, label],
        );
    }

    /// Record that a signed-in user has been on a board (for "My retros").
    pub fn upsert_participant(&self, slug: &str, user_id: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO participants (board_slug, user_id, first_seen_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(board_slug, user_id) DO NOTHING",
            params![slug, user_id, now_ms()],
        );
    }

    /// Boards a user created or joined, newest activity first.
    pub fn list_boards_for_user(&self, user_id: &str) -> rusqlite::Result<Vec<BoardRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT b.slug, b.label, b.created_by, b.host_key_hash, b.ended_at, b.created_at
             FROM boards b
             WHERE b.created_by = ?1
                OR b.slug IN (SELECT board_slug FROM participants WHERE user_id = ?1)
             ORDER BY b.last_active_at DESC, b.created_at DESC",
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok(BoardRow {
                slug: row.get(0)?,
                label: row.get(1)?,
                created_by: row.get(2)?,
                host_key_hash: row.get(3)?,
                ended_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        rows.collect()
    }
}
