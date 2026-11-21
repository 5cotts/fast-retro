//! Board reference IDs: a short code that names a board without being able to
//! open it.
//!
//! A board's slug in its URL is what lets anyone join and read it, so it must
//! never end up in a public bug report. The reference is the first 48 bits of
//! HMAC-SHA256(secret key, slug), shown as `xxxx-xxxx-xxxx`. Whoever reads a
//! public issue sees only that code; it can't be turned back into a slug, and
//! can't be guessed or recomputed without the key, which lives in the
//! database. The operator, who already holds the database, recomputes the code
//! for each board with `fast-retro find-board <ref>` and finds the match.
//!
//! This is an identifier, not a credential: knowing a reference grants no
//! access to anything.

use hmac::{Hmac, Mac};
use sha2::Sha256;

/// Domain separation, so this key can never produce a tag that means
/// something else if it is reused later.
const CONTEXT: &[u8] = b"fast-retro/board-ref/v1\0";

pub fn board_ref(key: &str, slug: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC takes a key of any length");
    mac.update(CONTEXT);
    mac.update(slug.as_bytes());
    let tag = mac.finalize().into_bytes();
    format!(
        "{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}",
        tag[0], tag[1], tag[2], tag[3], tag[4], tag[5]
    )
}

/// Accept a reference as people paste it (any case, with or without dashes or
/// spaces) and return it in the canonical `xxxx-xxxx-xxxx` form.
pub fn normalize_ref(input: &str) -> Option<String> {
    let hex: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if hex.len() != 12 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("{}-{}-{}", &hex[0..4], &hex[4..8], &hex[8..12]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_the_documented_shape() {
        let r = board_ref("key", "my-retro");
        assert_eq!(r.len(), 14);
        assert_eq!(normalize_ref(&r).as_deref(), Some(r.as_str()));
    }

    #[test]
    fn is_stable_for_the_same_key_and_slug() {
        assert_eq!(board_ref("key", "my-retro"), board_ref("key", "my-retro"));
    }

    #[test]
    fn differs_by_slug_and_by_key() {
        assert_ne!(board_ref("key", "my-retro"), board_ref("key", "my-retro2"));
        assert_ne!(board_ref("key", "my-retro"), board_ref("other", "my-retro"));
    }

    #[test]
    fn does_not_contain_the_slug_or_a_plain_hash_of_it() {
        use sha2::{Digest, Sha256};
        let r = board_ref("key", "abcd-ef01-2345");
        assert!(!r.contains("abcd-ef01-2345"));
        let plain = Sha256::digest(b"abcd-ef01-2345");
        let plain_ref = format!(
            "{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}",
            plain[0], plain[1], plain[2], plain[3], plain[4], plain[5]
        );
        assert_ne!(r, plain_ref);
    }

    #[test]
    fn normalizes_pasted_references() {
        assert_eq!(
            normalize_ref("7F3A-9C1E-B204").as_deref(),
            Some("7f3a-9c1e-b204")
        );
        assert_eq!(
            normalize_ref(" 7f3a9c1eb204 ").as_deref(),
            Some("7f3a-9c1e-b204")
        );
        assert_eq!(
            normalize_ref("7f3a 9c1e b204").as_deref(),
            Some("7f3a-9c1e-b204")
        );
    }

    #[test]
    fn rejects_anything_that_is_not_a_reference() {
        for bad in [
            "",
            "7f3a-9c1e",
            "7f3a-9c1e-b20",
            "7f3a-9c1e-b2044",
            "zzzz-9c1e-b204",
            "my-retro-slug",
        ] {
            assert_eq!(normalize_ref(bad), None, "{bad}");
        }
    }
}
