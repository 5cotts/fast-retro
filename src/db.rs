//! SQLite persistence for fast-retro.
//!
//! Phase 1 (this module): durable live boards. The CRDT `Doc` for each board is
//! persisted as a compacted snapshot in `board_docs` plus an append-only log of
//! raw updates in `doc_updates`. On room creation we hydrate from the snapshot
//! and replay the log; on shutdown/idle we compact. A restart therefore restores
//! every board exactly as it was.
//!
//! The schema also declares the tables the later phases (archives-in-DB, users,
//! sessions, participants) will use, so migrations are a no-op when we get there.
//! Only `board_docs` and `doc_updates` are wired up for now.

use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};

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

-- Declared now for later phases; not yet written to.
CREATE TABLE IF NOT EXISTS boards (
    slug           TEXT PRIMARY KEY,
    label          TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL DEFAULT 0,
    created_by     TEXT,
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
}
