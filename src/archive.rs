use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::db::Db;

const ARCHIVES_DIR: &str = "data/archives";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommentSnapshot {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub author_id: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CardSnapshot {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub author_id: String,
    #[serde(default)]
    pub votes: Vec<String>,
    #[serde(default)]
    pub reactions: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub comments: Vec<CommentSnapshot>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardCardsSnapshot {
    #[serde(default)]
    pub went_well: Vec<CardSnapshot>,
    #[serde(default)]
    pub to_improve: Vec<CardSnapshot>,
    #[serde(default)]
    pub actions: Vec<CardSnapshot>,
}

// `anonymous`, `phase` and `auto_sort` are optional so archives stored before
// they existed still load. A missing `anonymous` is treated as anonymous when
// exporting (see `boardfile.ts`), since older archives can't say otherwise.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRequest {
    #[serde(default)]
    pub label: String,
    pub cards: BoardCardsSnapshot,
    #[serde(default)]
    pub names: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub anonymous: Option<bool>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub auto_sort: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub id: String,
    pub slug: String,
    pub label: String,
    pub ended_at: i64,
    pub cards: BoardCardsSnapshot,
    #[serde(default)]
    pub names: serde_json::Map<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anonymous: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_sort: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSummary {
    pub id: String,
    pub slug: String,
    pub label: String,
    pub ended_at: i64,
    pub card_count: usize,
    pub top_voted: Option<String>,
}

impl Archive {
    pub fn card_count(&self) -> usize {
        self.cards.went_well.len() + self.cards.to_improve.len() + self.cards.actions.len()
    }

    pub fn top_voted_text(&self) -> Option<String> {
        let all = self
            .cards
            .went_well
            .iter()
            .chain(self.cards.to_improve.iter())
            .chain(self.cards.actions.iter());
        all.max_by_key(|c| c.votes.len())
            .filter(|c| !c.votes.is_empty())
            .map(|c| c.text.clone())
    }

    pub fn summary(&self) -> ArchiveSummary {
        ArchiveSummary {
            id: self.id.clone(),
            slug: self.slug.clone(),
            label: self.label.clone(),
            ended_at: self.ended_at,
            card_count: self.card_count(),
            top_voted: self.top_voted_text(),
        }
    }
}

fn archives_dir() -> PathBuf {
    PathBuf::from(ARCHIVES_DIR)
}

fn generate_id() -> String {
    use rand::Rng;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    let mut rng = rand::thread_rng();
    (0..12).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn save(
    db: &Db,
    slug: &str,
    req: ArchiveRequest,
    created_by: Option<&str>,
) -> Result<Archive, String> {
    let archive = Archive {
        id: generate_id(),
        slug: slug.to_string(),
        label: req.label,
        ended_at: now_ms(),
        cards: req.cards,
        // Never persist real names for an anonymous board, even if a client
        // sends them.
        names: if req.anonymous == Some(true) {
            serde_json::Map::new()
        } else {
            req.names
        },
        anonymous: req.anonymous,
        phase: req.phase,
        auto_sort: req.auto_sort,
    };
    db.save_archive(&archive, created_by).map_err(|e| e.to_string())?;
    Ok(archive)
}

pub fn list(db: &Db) -> Result<Vec<ArchiveSummary>, String> {
    let archives = db.list_archives().map_err(|e| e.to_string())?;
    Ok(archives.into_iter().map(|a| a.summary()).collect())
}

pub fn load(db: &Db, id: &str) -> Result<Option<Archive>, String> {
    db.load_archive(id).map_err(|e| e.to_string())
}

pub fn delete(db: &Db, id: &str) -> Result<bool, String> {
    db.delete_archive(id).map_err(|e| e.to_string())
}

/// One-time import of any pre-existing `data/archives/*.json` files into the
/// DB. Idempotent — skips ids already present, so it's safe to call on every
/// startup. The JSON files are left in place as a backup (not deleted).
pub fn migrate_from_json(db: &Db) -> std::io::Result<usize> {
    let dir = archives_dir();
    if !dir.exists() {
        return Ok(0);
    }
    let mut imported = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.starts_with('.'))
            .unwrap_or(true)
        {
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let arch: Archive = match serde_json::from_slice(&bytes) {
            Ok(a) => a,
            Err(_) => continue,
        };
        if db.archive_exists(&arch.id) {
            continue;
        }
        if let Err(e) = db.save_archive(&arch, None) {
            tracing::warn!("archive migration: failed to import {}: {}", arch.id, e);
            continue;
        }
        imported += 1;
    }
    Ok(imported)
}

#[allow(dead_code)]
pub fn archives_root() -> &'static Path {
    Path::new(ARCHIVES_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Db {
        Db::open(":memory:").expect("open in-memory db")
    }

    #[test]
    fn archive_without_new_fields_still_loads() {
        let json = r#"{
            "id": "old1",
            "slug": "old-board",
            "label": "Old",
            "endedAt": 1,
            "cards": { "wentWell": [{ "id": "c1", "text": "hi" }] },
            "names": { "u1": "Alice" }
        }"#;
        let a: Archive = serde_json::from_str(json).expect("old archive parses");
        assert_eq!(a.anonymous, None);
        assert_eq!(a.phase, None);
        assert_eq!(a.auto_sort, None);
        let out = serde_json::to_value(&a).unwrap();
        assert!(out.get("anonymous").is_none());
        assert!(out.get("autoSort").is_none());
    }

    #[test]
    fn new_fields_round_trip_through_the_db() {
        let db = test_db();
        let req: ArchiveRequest = serde_json::from_str(
            r#"{
                "label": "Sprint",
                "cards": { "wentWell": [], "toImprove": [], "actions": [] },
                "names": { "u1": "Alice" },
                "anonymous": false,
                "phase": "discuss",
                "autoSort": false
            }"#,
        )
        .unwrap();
        let saved = save(&db, "sprint", req, None).unwrap();
        let loaded = load(&db, &saved.id).unwrap().expect("archive stored");
        assert_eq!(loaded.anonymous, Some(false));
        assert_eq!(loaded.phase.as_deref(), Some("discuss"));
        assert_eq!(loaded.auto_sort, Some(false));
        assert_eq!(loaded.names.get("u1").and_then(|v| v.as_str()), Some("Alice"));
    }

    #[test]
    fn anonymous_archive_drops_names() {
        let db = test_db();
        let req: ArchiveRequest = serde_json::from_str(
            r#"{
                "cards": { "wentWell": [] },
                "names": { "u1": "Alice" },
                "anonymous": true
            }"#,
        )
        .unwrap();
        let saved = save(&db, "anon", req, None).unwrap();
        let loaded = load(&db, &saved.id).unwrap().unwrap();
        assert_eq!(loaded.anonymous, Some(true));
        assert!(loaded.names.is_empty());
    }
}
