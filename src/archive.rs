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

#[derive(Debug, Deserialize)]
pub struct ArchiveRequest {
    #[serde(default)]
    pub label: String,
    pub cards: BoardCardsSnapshot,
    #[serde(default)]
    pub names: serde_json::Map<String, serde_json::Value>,
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
        names: req.names,
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
