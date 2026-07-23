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

use crate::archive::Archive;

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

    // ---------- archives ----------

    /// Insert (or overwrite) an archive row. The whole `Archive` is stored as a
    /// JSON blob in `snapshot`; `slug`/`label`/`ended_at` are duplicated into
    /// their own columns purely so `list_archives` can sort/filter without
    /// deserializing every row.
    pub fn save_archive(&self, archive: &Archive) -> rusqlite::Result<()> {
        let snapshot = serde_json::to_string(archive)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO archives (id, slug, label, ended_at, snapshot) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, label = excluded.label,
                 ended_at = excluded.ended_at, snapshot = excluded.snapshot",
            params![archive.id, archive.slug, archive.label, archive.ended_at, snapshot],
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
}
