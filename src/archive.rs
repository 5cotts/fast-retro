use std::{
    collections::BTreeMap,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<String>,
    // Canvas boards only. Absent means the card never left its starting slot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<CardPosSnapshot>,
}

/// Where a card sits on a canvas board, in world coordinates.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub struct CardPosSnapshot {
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub z: f64,
}

/// Cards keyed by column key. Classic boards use `wentWell`, `toImprove` and
/// `actions`; custom boards use the keys in `columns`. Transparent, so the
/// JSON is the same object archives have always stored.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(transparent)]
pub struct BoardCardsSnapshot(pub BTreeMap<String, Vec<CardSnapshot>>);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSnapshot {
    pub key: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// A group of cards across columns. Cards point at it with `cluster_id`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSnapshot {
    pub id: String,
    #[serde(default)]
    pub label: String,
}

// Bounds on what a client can make the server store. Labels match the frontend
// (clusters.ts).
const MAX_CLUSTERS: usize = 1000;
const MAX_CLUSTER_LABEL_CHARS: usize = 60;
const MAX_CLUSTER_ID_LEN: usize = 64;

// Matches the frontend (canvas.ts), which clamps positions on every read.
const WORLD_LIMIT: f64 = 20_000.0;
const MAX_Z: f64 = 1_000_000_000.0;
const CANVAS_LAYOUT: &str = "canvas";

// Matches the frontend (columns.ts): 50 input columns plus Action items. Not a
// product limit, just a bound on what a client can make the server store.
const MAX_COLUMNS: usize = 51;
const MAX_COLUMN_TITLE_CHARS: usize = 100;

fn valid_column_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 32
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
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
    #[serde(default)]
    pub hide_cards: Option<bool>,
    // Absent for classic three-column boards.
    #[serde(default)]
    pub columns: Option<Vec<ColumnSnapshot>>,
    // Absent for boards with no groups.
    #[serde(default)]
    pub clusters: Option<Vec<ClusterSnapshot>>,
    // Absent for column boards.
    #[serde(default)]
    pub layout: Option<String>,
}

impl ArchiveRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.cards.0.len() > MAX_COLUMNS {
            return Err("too many columns".into());
        }
        if let Some(key) = self.cards.0.keys().find(|k| !valid_column_key(k)) {
            return Err(format!("bad column key: {key:?}"));
        }
        if let Some(columns) = &self.columns {
            if columns.len() > MAX_COLUMNS {
                return Err("too many columns".into());
            }
            for c in columns {
                if !valid_column_key(&c.key) {
                    return Err(format!("bad column key: {:?}", c.key));
                }
                if c.title.chars().count() > MAX_COLUMN_TITLE_CHARS {
                    return Err("column title too long".into());
                }
            }
        }
        if let Some(clusters) = &self.clusters {
            if clusters.len() > MAX_CLUSTERS {
                return Err("too many groups".into());
            }
            for c in clusters {
                if c.id.is_empty() || c.id.len() > MAX_CLUSTER_ID_LEN {
                    return Err("bad group id".into());
                }
                if c.label.chars().count() > MAX_CLUSTER_LABEL_CHARS {
                    return Err("group name too long".into());
                }
            }
        }
        let long_cluster_id = self
            .cards
            .0
            .values()
            .flatten()
            .filter_map(|card| card.cluster_id.as_ref())
            .any(|id| id.len() > MAX_CLUSTER_ID_LEN);
        if long_cluster_id {
            return Err("bad group id".into());
        }
        if self.layout.as_deref().is_some_and(|l| l != CANVAS_LAYOUT) {
            return Err("unknown layout".into());
        }
        let bad_pos = self
            .cards
            .0
            .values()
            .flatten()
            .filter_map(|card| card.pos)
            .any(|p| p.x.abs() > WORLD_LIMIT || p.y.abs() > WORLD_LIMIT || !(0.0..=MAX_Z).contains(&p.z));
        if bad_pos {
            return Err("card position out of bounds".into());
        }
        Ok(())
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_cards: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<ColumnSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clusters: Option<Vec<ClusterSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
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
        self.cards.0.values().map(Vec::len).sum()
    }

    pub fn top_voted_text(&self) -> Option<String> {
        self.cards
            .0
            .values()
            .flatten()
            .max_by_key(|c| c.votes.len())
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
    req.validate()?;
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
        hide_cards: req.hide_cards,
        columns: req.columns,
        clusters: req.clusters,
        layout: req.layout,
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
        assert_eq!(a.hide_cards, None);
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
                "autoSort": false,
                "hideCards": true
            }"#,
        )
        .unwrap();
        let saved = save(&db, "sprint", req, None).unwrap();
        let loaded = load(&db, &saved.id).unwrap().expect("archive stored");
        assert_eq!(loaded.anonymous, Some(false));
        assert_eq!(loaded.phase.as_deref(), Some("discuss"));
        assert_eq!(loaded.auto_sort, Some(false));
        assert_eq!(loaded.hide_cards, Some(true));
        assert_eq!(loaded.names.get("u1").and_then(|v| v.as_str()), Some("Alice"));
    }

    #[test]
    fn custom_columns_round_trip_through_the_db() {
        let db = test_db();
        let req: ArchiveRequest = serde_json::from_str(
            r#"{
                "label": "Brainstorm",
                "cards": {
                    "c-abc": [{ "id": "1", "text": "idea", "votes": ["u1", "u2"] }],
                    "c-def": [{ "id": "2", "text": "other" }],
                    "actions": []
                },
                "columns": [
                    { "key": "c-abc", "title": "Problem one", "color": "emerald" },
                    { "key": "c-def", "title": "Problem two" },
                    { "key": "actions", "title": "Action items", "color": "sky" }
                ]
            }"#,
        )
        .unwrap();
        let saved = save(&db, "brainstorm", req, None).unwrap();
        let loaded = load(&db, &saved.id).unwrap().unwrap();
        let cols = loaded.columns.as_ref().expect("columns stored");
        assert_eq!(
            cols.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(),
            ["c-abc", "c-def", "actions"]
        );
        assert_eq!(cols[1].color, None);
        assert_eq!(loaded.card_count(), 2);
        assert_eq!(loaded.top_voted_text().as_deref(), Some("idea"));
        assert_eq!(loaded.cards.0["c-def"][0].text, "other");
    }

    #[test]
    fn legacy_archive_keeps_its_shape_and_counts() {
        let json = r#"{
            "id": "old2",
            "slug": "old",
            "label": "Old",
            "endedAt": 1,
            "cards": {
                "wentWell": [{ "id": "a", "text": "x" }],
                "toImprove": [{ "id": "b", "text": "y", "votes": ["u1"] }],
                "actions": []
            }
        }"#;
        let a: Archive = serde_json::from_str(json).unwrap();
        assert_eq!(a.card_count(), 2);
        assert_eq!(a.top_voted_text().as_deref(), Some("y"));
        assert!(a.columns.is_none());
        let out = serde_json::to_value(&a).unwrap();
        assert!(out.get("columns").is_none());
        assert_eq!(out["cards"]["wentWell"][0]["text"], "x");
        assert!(out["cards"]["actions"].as_array().unwrap().is_empty());
    }

    #[test]
    fn rejects_bad_columns() {
        let db = test_db();
        let bad_key: ArchiveRequest =
            serde_json::from_str(r#"{ "cards": { "bad key!": [] } }"#).unwrap();
        assert!(save(&db, "x", bad_key, None).is_err());

        let long_title = format!(
            r#"{{ "cards": {{}}, "columns": [{{ "key": "a", "title": "{}" }}] }}"#,
            "x".repeat(101)
        );
        let req: ArchiveRequest = serde_json::from_str(&long_title).unwrap();
        assert!(save(&db, "x", req, None).is_err());

        let many: serde_json::Map<String, serde_json::Value> = (0..52)
            .map(|i| (format!("k{i}"), serde_json::json!([])))
            .collect();
        let req: ArchiveRequest =
            serde_json::from_value(serde_json::json!({ "cards": many })).unwrap();
        assert!(save(&db, "x", req, None).is_err());
    }

    #[test]
    fn groups_round_trip_through_the_db() {
        let db = test_db();
        let req: ArchiveRequest = serde_json::from_str(
            r#"{
                "cards": {
                    "wentWell": [{ "id": "1", "text": "a", "clusterId": "g1" }],
                    "toImprove": [{ "id": "2", "text": "b" }]
                },
                "clusters": [{ "id": "g1", "label": "Deploys" }]
            }"#,
        )
        .unwrap();
        let saved = save(&db, "groups", req, None).unwrap();
        let loaded = load(&db, &saved.id).unwrap().unwrap();
        assert_eq!(loaded.cards.0["wentWell"][0].cluster_id.as_deref(), Some("g1"));
        assert_eq!(loaded.cards.0["toImprove"][0].cluster_id, None);
        let out = serde_json::to_value(&loaded).unwrap();
        assert_eq!(out["clusters"][0]["label"], "Deploys");
        assert_eq!(out["cards"]["wentWell"][0]["clusterId"], "g1");
        assert!(out["cards"]["toImprove"][0].get("clusterId").is_none());
    }

    #[test]
    fn archive_without_groups_stores_no_group_fields() {
        let db = test_db();
        let req: ArchiveRequest =
            serde_json::from_str(r#"{ "cards": { "wentWell": [{ "id": "1", "text": "a" }] } }"#).unwrap();
        let saved = save(&db, "plain", req, None).unwrap();
        let out = serde_json::to_value(&saved).unwrap();
        assert!(out.get("clusters").is_none());
    }

    #[test]
    fn rejects_oversized_groups() {
        let db = test_db();
        let cases = [
            serde_json::json!({ "cards": {}, "clusters": [{ "id": "g", "label": "x".repeat(61) }] }),
            serde_json::json!({ "cards": {}, "clusters": [{ "id": "x".repeat(65), "label": "ok" }] }),
            serde_json::json!({ "cards": {}, "clusters": [{ "id": "", "label": "ok" }] }),
            serde_json::json!({
                "cards": { "wentWell": [{ "id": "1", "text": "a", "clusterId": "x".repeat(65) }] }
            }),
            serde_json::json!({
                "cards": {},
                "clusters": (0..1001).map(|i| serde_json::json!({ "id": format!("g{i}") })).collect::<Vec<_>>()
            }),
        ];
        for case in cases {
            let req: ArchiveRequest = serde_json::from_value(case).unwrap();
            assert!(save(&db, "x", req, None).is_err());
        }
        let label_at_limit =
            serde_json::json!({ "cards": {}, "clusters": [{ "id": "g", "label": "é".repeat(60) }] });
        let req: ArchiveRequest = serde_json::from_value(label_at_limit).unwrap();
        assert!(save(&db, "x", req, None).is_ok());
    }

    #[test]
    fn canvas_layout_and_positions_round_trip_through_the_db() {
        let db = test_db();
        let req: ArchiveRequest = serde_json::from_str(
            r#"{
                "cards": {
                    "wentWell": [
                        { "id": "1", "text": "moved", "pos": { "x": -120.5, "y": 40, "z": 3 } },
                        { "id": "2", "text": "unmoved" }
                    ]
                },
                "layout": "canvas"
            }"#,
        )
        .unwrap();
        let saved = save(&db, "canvas", req, None).unwrap();
        let loaded = load(&db, &saved.id).unwrap().unwrap();
        assert_eq!(loaded.layout.as_deref(), Some("canvas"));
        assert_eq!(
            loaded.cards.0["wentWell"][0].pos,
            Some(CardPosSnapshot { x: -120.5, y: 40.0, z: 3.0 })
        );
        assert_eq!(loaded.cards.0["wentWell"][1].pos, None);
        let out = serde_json::to_value(&loaded).unwrap();
        assert_eq!(out["layout"], "canvas");
        assert_eq!(out["cards"]["wentWell"][0]["pos"]["x"], -120.5);
        assert!(out["cards"]["wentWell"][1].get("pos").is_none());
    }

    #[test]
    fn archive_without_a_layout_stores_no_canvas_fields() {
        let db = test_db();
        let req: ArchiveRequest =
            serde_json::from_str(r#"{ "cards": { "wentWell": [{ "id": "1", "text": "a" }] } }"#).unwrap();
        let saved = save(&db, "plain", req, None).unwrap();
        let out = serde_json::to_value(&saved).unwrap();
        assert!(out.get("layout").is_none());
        assert!(out["cards"]["wentWell"][0].get("pos").is_none());
    }

    #[test]
    fn rejects_unknown_layouts_and_out_of_bounds_positions() {
        let db = test_db();
        let card = |pos: serde_json::Value| {
            serde_json::json!({ "cards": { "wentWell": [{ "id": "1", "text": "a", "pos": pos }] } })
        };
        let cases = [
            serde_json::json!({ "cards": {}, "layout": "spiral" }),
            card(serde_json::json!({ "x": 20_001, "y": 0, "z": 1 })),
            card(serde_json::json!({ "x": 0, "y": -20_001, "z": 1 })),
            card(serde_json::json!({ "x": 0, "y": 0, "z": -1 })),
            card(serde_json::json!({ "x": 0, "y": 0, "z": 1_000_000_001_i64 })),
        ];
        for case in cases {
            let req: ArchiveRequest = serde_json::from_value(case).unwrap();
            assert!(save(&db, "x", req, None).is_err());
        }
        let at_limit: ArchiveRequest =
            serde_json::from_value(card(serde_json::json!({ "x": 20_000, "y": -20_000, "z": 0 }))).unwrap();
        assert!(save(&db, "x", at_limit, None).is_ok());
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
