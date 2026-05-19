use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

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

fn ensure_dir() -> std::io::Result<()> {
    fs::create_dir_all(archives_dir())
}

fn id_is_safe(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn archive_path(id: &str) -> Option<PathBuf> {
    if !id_is_safe(id) {
        return None;
    }
    Some(archives_dir().join(format!("{id}.json")))
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

pub fn save(slug: &str, req: ArchiveRequest) -> std::io::Result<Archive> {
    ensure_dir()?;
    let id = generate_id();
    let archive = Archive {
        id: id.clone(),
        slug: slug.to_string(),
        label: req.label,
        ended_at: now_ms(),
        cards: req.cards,
        names: req.names,
    };
    let path = archives_dir().join(format!("{id}.json"));
    let tmp = archives_dir().join(format!(".{id}.json.tmp"));
    let bytes = serde_json::to_vec_pretty(&archive)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    fs::rename(tmp, path)?;
    Ok(archive)
}

pub fn list() -> std::io::Result<Vec<ArchiveSummary>> {
    ensure_dir()?;
    let mut out: Vec<Archive> = Vec::new();
    for entry in fs::read_dir(archives_dir())? {
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
        if let Ok(arch) = serde_json::from_slice::<Archive>(&bytes) {
            out.push(arch);
        }
    }
    out.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    Ok(out.into_iter().map(|a| a.summary()).collect())
}

pub fn load(id: &str) -> std::io::Result<Option<Archive>> {
    let path = match archive_path(id) {
        Some(p) => p,
        None => return Ok(None),
    };
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path)?;
    let arch: Archive = serde_json::from_slice(&bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(Some(arch))
}

pub fn delete(id: &str) -> std::io::Result<bool> {
    let path = match archive_path(id) {
        Some(p) => p,
        None => return Ok(false),
    };
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path)?;
    Ok(true)
}

#[allow(dead_code)]
pub fn archives_root() -> &'static Path {
    Path::new(ARCHIVES_DIR)
}
