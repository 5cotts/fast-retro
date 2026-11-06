//! Minimal y-protocol implementation: varint framing, sync messages, awareness.
//!
//! Wire format (matches `y-protocols`):
//!   message := message_type:varuint payload
//!     message_type 0 (sync):
//!       payload := sync_type:varuint length:varuint data:[u8;length]
//!         sync_type 0 = SyncStep1 (state vector)
//!         sync_type 1 = SyncStep2 (update)
//!         sync_type 2 = Update    (incremental update)
//!     message_type 1 (awareness):
//!       payload := length:varuint data:[u8;length]
//!         data is itself a structured awareness update encoded by y-protocols
//!
//! Awareness update format (y-protocols/awareness):
//!   count:varuint
//!   for each:
//!     clientID:varuint
//!     clock:varuint
//!     stateJSON:varstring   ("null" if absent)

use std::collections::HashMap;

use yrs::{
    updates::{decoder::Decode, encoder::Encode},
    Any, Array, Doc as YDoc, Map, Out, ReadTxn, StateVector, Transact, Update,
};

pub type ClientId = u64;

// ---------- varint cursor ----------

pub struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }

    pub fn read_var_uint(&mut self) -> Result<u64, &'static str> {
        let mut result: u64 = 0;
        let mut shift = 0u32;
        loop {
            if self.pos >= self.buf.len() {
                return Err("unexpected eof in varint");
            }
            let byte = self.buf[self.pos];
            self.pos += 1;
            result |= ((byte & 0x7f) as u64) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
            if shift >= 64 {
                return Err("varint overflow");
            }
        }
    }

    pub fn read_var_bytes(&mut self) -> Result<&'a [u8], &'static str> {
        let len = self.read_var_uint()? as usize;
        if self.pos + len > self.buf.len() {
            return Err("var_bytes length exceeds buffer");
        }
        let out = &self.buf[self.pos..self.pos + len];
        self.pos += len;
        Ok(out)
    }

    pub fn read_var_string(&mut self) -> Result<String, &'static str> {
        let bytes = self.read_var_bytes()?;
        std::str::from_utf8(bytes)
            .map(|s| s.to_string())
            .map_err(|_| "invalid utf8")
    }
}

pub fn write_var_uint(buf: &mut Vec<u8>, mut n: u64) {
    while n > 0x7f {
        buf.push(((n & 0x7f) as u8) | 0x80);
        n >>= 7;
    }
    buf.push(n as u8);
}

pub fn write_var_bytes(buf: &mut Vec<u8>, data: &[u8]) {
    write_var_uint(buf, data.len() as u64);
    buf.extend_from_slice(data);
}

pub fn write_var_string(buf: &mut Vec<u8>, s: &str) {
    write_var_bytes(buf, s.as_bytes());
}

// ---------- message encoders ----------

const MSG_SYNC: u64 = 0;
const MSG_AWARENESS: u64 = 1;

const SYNC_STEP1: u64 = 0;
const SYNC_STEP2: u64 = 1;
const SYNC_UPDATE: u64 = 2;

pub fn encode_sync_step1(state_vector: &[u8]) -> Vec<u8> {
    let mut payload = Vec::new();
    write_var_uint(&mut payload, SYNC_STEP1);
    write_var_bytes(&mut payload, state_vector);
    let mut out = Vec::new();
    write_var_uint(&mut out, MSG_SYNC);
    out.extend_from_slice(&payload);
    out
}

pub fn encode_sync_step2(update: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    write_var_uint(&mut out, MSG_SYNC);
    write_var_uint(&mut out, SYNC_STEP2);
    write_var_bytes(&mut out, update);
    out
}

pub fn encode_sync_update(update: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    write_var_uint(&mut out, MSG_SYNC);
    write_var_uint(&mut out, SYNC_UPDATE);
    write_var_bytes(&mut out, update);
    out
}

pub fn encode_awareness(update: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    write_var_uint(&mut out, MSG_AWARENESS);
    write_var_bytes(&mut out, update);
    out
}

// ---------- doc wrapper ----------

pub struct Doc {
    doc: YDoc,
}

#[derive(Debug, Clone)]
pub struct BoardSummary {
    pub label: String,
    pub card_count: usize,
    pub phase: String,
    pub anonymous: bool,
}

impl Doc {
    pub fn new() -> Self {
        Self { doc: YDoc::new() }
    }

    pub fn state_vector(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.state_vector().encode_v1()
    }

    pub fn encode_state_as_update_v1(&self, state_vector_v1: &[u8]) -> Vec<u8> {
        let sv = if state_vector_v1.is_empty() {
            StateVector::default()
        } else {
            StateVector::decode_v1(state_vector_v1).unwrap_or_default()
        };
        let txn = self.doc.transact();
        txn.encode_state_as_update_v1(&sv)
    }

    /// Apply an update and return the same update bytes if applied successfully (for broadcast).
    pub fn apply_update_v1(&mut self, update_v1: &[u8]) -> Result<Vec<u8>, String> {
        let update = Update::decode_v1(update_v1).map_err(|e| format!("decode update: {}", e))?;
        let mut txn = self.doc.transact_mut();
        txn.apply_update(update)
            .map_err(|e| format!("apply update: {}", e))?;
        Ok(update_v1.to_vec())
    }

    /// Record that the board has ended, unless a client already did (a tab still
    /// running an older frontend writes this itself). Returns the update to
    /// persist and broadcast, if anything changed.
    pub fn mark_ended(&mut self, ended_at_ms: i64, message: &str) -> Option<Vec<u8>> {
        let meta = self.doc.get_or_insert_map("meta");
        let mut txn = self.doc.transact_mut();
        if meta.get(&txn, "endedAt").is_some() {
            return None;
        }
        // A float: yrs encodes an i64 as a BigInt, and the client only accepts a
        // JS number here (readBoardEndedAt).
        meta.insert(&mut txn, "endedAt", ended_at_ms as f64);
        if !message.is_empty() {
            meta.insert(&mut txn, "endedMessage", message);
        }
        Some(txn.encode_update_v1())
    }

    /// Read a lightweight summary of the board (label, total cards, phase, anonymous mode).
    /// Used by the host dashboard to list active boards without subscribing to each room.
    pub fn read_summary(&self) -> BoardSummary {
        let meta = self.doc.get_or_insert_map("meta");
        let phase_map = self.doc.get_or_insert_map("phase");
        let board = self.doc.get_or_insert_map("board");
        let txn = self.doc.transact();

        let label = match meta.get(&txn, "label") {
            Some(Out::Any(Any::String(s))) => s.to_string(),
            _ => String::new(),
        };

        let anonymous = matches!(
            meta.get(&txn, "anonymous"),
            Some(Out::Any(Any::Bool(true)))
        );

        let phase = match phase_map.get(&txn, "current") {
            Some(Out::Any(Any::String(s))) => s.to_string(),
            _ => "brainstorm".to_string(),
        };

        // Every column array counts, whatever its key, so custom-column boards
        // report the right total without the server knowing the column list.
        let card_count = board
            .iter(&txn)
            .map(|(_, v)| match v {
                Out::YArray(arr) => arr.len(&txn) as usize,
                _ => 0,
            })
            .sum();

        BoardSummary {
            label,
            card_count,
            phase,
            anonymous,
        }
    }
}

// ---------- awareness ----------
//
// We maintain the canonical awareness map (clientID -> (clock, state-json-or-null)).
// We re-encode updates so the server can authoritatively gossip presence to new joiners.

pub struct Awareness {
    states: HashMap<u64, (u64, String)>, // clientID -> (clock, state JSON ("null" means removed))
}

impl Awareness {
    pub fn new() -> Self {
        Self {
            states: HashMap::new(),
        }
    }

    /// Apply an incoming awareness update. Returns a re-encoded update of the entries that changed.
    pub fn apply_update(&mut self, payload: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let mut cursor = Cursor::new(payload);
        let count = cursor.read_var_uint().map_err(|e| e.to_string())?;
        let mut changed: Vec<(u64, u64, String)> = Vec::new();
        for _ in 0..count {
            let cid = cursor.read_var_uint().map_err(|e| e.to_string())?;
            let clock = cursor.read_var_uint().map_err(|e| e.to_string())?;
            let state = cursor.read_var_string().map_err(|e| e.to_string())?;
            let entry = self.states.get(&cid).cloned();
            let accept = match entry {
                None => true,
                Some((existing_clock, existing_state)) => {
                    clock > existing_clock || (clock == existing_clock && existing_state != state)
                }
            };
            if accept {
                self.states.insert(cid, (clock, state.clone()));
                changed.push((cid, clock, state));
            }
        }
        if changed.is_empty() {
            return Ok(None);
        }
        let mut out = Vec::new();
        write_var_uint(&mut out, changed.len() as u64);
        for (cid, clock, state) in changed {
            write_var_uint(&mut out, cid);
            write_var_uint(&mut out, clock);
            write_var_string(&mut out, &state);
        }
        Ok(Some(out))
    }

    /// Encode the full current awareness state for a newly connected peer.
    pub fn encode_full(&self) -> Option<Vec<u8>> {
        if self.states.is_empty() {
            return None;
        }
        let mut out = Vec::new();
        write_var_uint(&mut out, self.states.len() as u64);
        for (cid, (clock, state)) in &self.states {
            write_var_uint(&mut out, *cid);
            write_var_uint(&mut out, *clock);
            write_var_string(&mut out, state);
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::ArrayPrelim;

    fn ended_fields(update: &[u8]) -> (Option<Out>, Option<Out>) {
        let peer = YDoc::new();
        peer.transact_mut()
            .apply_update(Update::decode_v1(update).unwrap())
            .unwrap();
        let meta = peer.get_or_insert_map("meta");
        let txn = peer.transact();
        (meta.get(&txn, "endedAt"), meta.get(&txn, "endedMessage"))
    }

    #[test]
    fn mark_ended_writes_a_js_number_once() {
        let mut doc = Doc::new();
        let update = doc.mark_ended(1_700_000_000_000, "Nice").unwrap();
        let (at, message) = ended_fields(&update);
        assert!(matches!(at, Some(Out::Any(Any::Number(n))) if n == 1_700_000_000_000.0));
        assert!(matches!(message, Some(Out::Any(Any::String(s))) if &*s == "Nice"));
        assert!(doc.mark_ended(2, "Again").is_none());
    }

    #[test]
    fn mark_ended_without_a_message_leaves_it_unset() {
        let update = Doc::new().mark_ended(1, "").unwrap();
        assert!(ended_fields(&update).1.is_none());
    }

    #[test]
    fn mark_ended_keeps_what_an_older_client_wrote() {
        let src = YDoc::new();
        let meta = src.get_or_insert_map("meta");
        meta.insert(&mut src.transact_mut(), "endedAt", 5.0);
        let update = src.transact().encode_state_as_update_v1(&StateVector::default());
        let mut doc = Doc::new();
        doc.apply_update_v1(&update).unwrap();
        assert!(doc.mark_ended(9, "Nice").is_none());
    }

    #[test]
    fn card_count_includes_every_column() {
        let src = YDoc::new();
        let board = src.get_or_insert_map("board");
        {
            let mut txn = src.transact_mut();
            board.insert(&mut txn, "c-abc", ArrayPrelim::from(vec![Any::from(1), Any::from(2)]));
            board.insert(&mut txn, "wentWell", ArrayPrelim::from(vec![Any::from(3)]));
            board.insert(&mut txn, "actions", ArrayPrelim::default());
            board.insert(&mut txn, "notAnArray", Any::from("x"));
        }
        let update = src.transact().encode_state_as_update_v1(&StateVector::default());
        let mut doc = Doc::new();
        doc.apply_update_v1(&update).unwrap();
        assert_eq!(doc.read_summary().card_count, 3);
    }
}
