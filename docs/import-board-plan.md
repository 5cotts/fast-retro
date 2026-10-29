# Plan: export a board to JSON and import it again

**Status:** proposal, not implemented yet. Revised 2026-10-29: switched the round-trip format from CSV to JSON after review.
**Goal:** a user exports a board to a file, imports that file later, and gets a board that looks the same as it did at export time: same cards, order, votes, reactions and comments, plus author names when the board isn't anonymous.

## Decisions (from review)

- **JSON is the round-trip format.** A new **Download JSON** export produces a `.fastretro.json` file, and that file is what import accepts.
- **CSV stays as a one-way export** for reading in Sheets or Excel. It isn't importable.
- **No Google sign-in required to import.** Anyone who can create a board can import one.
- **Votes and reactions are kept** on import, under their original user IDs.
- **Author names are restored only when the board isn't anonymous.**

## Why JSON and not CSV

The earlier revision of this plan made CSV lossless by adding a `card_json` column to every row. That's a JSON file inside a CSV file, and the CSV layer only adds risk:

- The human-readable columns and `card_json` can disagree once someone edits the file, so import needs heuristics to decide which one wins.
- Excel opens a UTF-8 CSV without a BOM in the legacy encoding, so re-saving turns emoji reactions into mojibake. It also silently truncates cells over 32,767 characters, which would corrupt `card_json`.
- The formula-injection guard (a leading `'` on risky cells) can't always be reversed.
- Import would need a hand-written RFC 4180 parser and a two-version CSV format matrix.

Dumping from SQLite isn't an option either. Boards aren't stored as rows; each one is a Yjs CRDT binary (`board_docs.ydoc` plus `doc_updates` in `src/db.rs`). Exporting that binary would be opaque, tie the file to the internal doc layout, keep the original card IDs (so importing twice collides), and leak names: the doc's `names` map holds real names even on anonymous boards.

JSON avoids all of this, and the shape already exists: ended retros are stored as JSON in the `archives` table, using `CardSnapshot` / `CommentSnapshot` / `BoardCardsSnapshot` in `src/archive.rs` and `CardData` / `CommentData` in `frontend/src/lib/types.ts`.

## What exists today

- **Download CSV** is host-only, in lead controls (`LeadControls.svelte`). End retro has an "export first" checkbox that calls the same download. Code: `frontend/src/lib/csv.ts`, `Board.svelte` (`downloadCSV`).
- Board state is a Yjs doc (`board`, `meta`, `names`, `phase`, `timer`). `meta` holds `label`, `anonymous` and `autoSort`; `phase` holds `current`. The server (`src/main.rs`) applies any client update unless the board has ended, so writes are client-driven. `yboard.ts` has `rehydrateCard(snapshot)`, which turns a plain `CardData` into a `Y.Map` card.
- New boards get their initial label and anonymous flag through a sessionStorage handoff (`setPendingLabel` / `setPendingAnonymous` in `boards.ts`), consumed by a host-only, run-once `$effect` in `Board.svelte` after the first sync.
- Archive reads (`GET /api/archives`, `/api/archives/:id`) require the global lead token. Signed-in users only get archive summaries (`/api/me/archives`).
- Limits: WebSocket message and frame 2 MiB, HTTP body 5 MiB (`MAX_*` in `main.rs`).

Export and import are frontend-only. The one Rust change is a small fix to what archives store (§4).

## 1. File format: `.fastretro.json`

```json
{
  "format": "fast-retro",
  "version": 1,
  "exportedAt": 1793238600000,
  "board": {
    "label": "Sprint 42",
    "anonymous": false,
    "phase": "discuss",
    "autoSort": true
  },
  "names": { "u_abc": "Alice", "u_def": "Bob" },
  "cards": {
    "wentWell": [
      {
        "id": "c_1",
        "text": "Shipped the thing",
        "authorId": "u_abc",
        "votes": ["u_abc", "u_def"],
        "reactions": { "👍": ["u_abc", "u_def"] },
        "comments": [
          { "id": "m_1", "text": "Nice", "authorId": "u_def", "createdAt": 1793238519483 }
        ]
      }
    ],
    "toImprove": [],
    "actions": []
  }
}
```

- **`cards`** uses the same shape as the archive snapshot (`BoardCardsSnapshot`), so one schema serves both. Cards are in the underlying array order, not the vote-sorted display; sort-by-votes is display-only (`sortedByVotes` in `Board.svelte`), so restoring the array order plus `autoSort` gives the same view.
- **IDs stay in the file** to keep the shape identical to archives. Import ignores them and generates new ones (§2).
- **`names`** is omitted entirely when `anonymous` is true, so an anonymous board's file never contains real names. When it's present, it's filtered to user IDs the file actually references (authors, voters, reactors, commenters), not everyone who ever opened the board.
- **Author IDs stay** on anonymous boards. They're opaque random IDs and are needed for "your card" ownership and for toggling your own votes and reactions.
- **Not exported:** timer state, which resets on import, and the ended flag. An imported board is always live and editable.
- **`version`** is an integer. Import rejects a higher version than it understands with "This file was exported by a newer version of fast-retro." Additive changes don't bump it, because unknown keys are ignored.
- The file is written pretty-printed with a `.fastretro.json` extension and named after the board, e.g. `sprint-42-2026-10-29.fastretro.json`, falling back to `retro-<timestamp>` when there's no label.

## 2. Export

New module `frontend/src/lib/boardfile.ts`:

- `exportBoardFile(state): BoardFile` builds the object above from `conn.state` (cards, label, anonymous, phase, autoSort, names).
- `downloadBoardFile(file)` does the Blob download, sharing a small helper with `downloadCSV`.

UI:

- **Download JSON** next to **Download CSV** in `LeadControls.svelte`, host-only like CSV. The tooltip says "Full copy you can import later."
- End retro's **export first** checkbox downloads the JSON file, since that's the one that can be restored. CSV stays a separate button.
- The docs page (`routes/docs/+page.svelte`) describes both: CSV for spreadsheets, JSON for backup and re-import.

## 3. Import

### Parsing and validation (`boardfile.ts`)

`parseBoardFile(text): { file, warnings[] } | { error }`:

- `JSON.parse`, then hand-written type guards. Reject anything without `format: "fast-retro"` or with an unsupported `version`, with a clear message.
- Unknown keys are dropped. Missing arrays and maps become empty. Unknown `phase` values fall back to Brainstorm. Cards with non-string text are skipped with a warning.
- If `board.anonymous` is true, `names` is ignored even if a hand-edited file includes it.
- **Caps** (named constants): file ≤ 1 MiB, ≤ 300 cards, ≤ 50 comments per card, text ≤ 2,000 characters. These keep the single import transaction well below the 2 MiB WebSocket frame and fit easily in sessionStorage.
- **Card and comment IDs are regenerated** with `newId()`. Importing the same file twice must not create duplicate IDs, because `mergeCards`, `moveCard` and other ID-based lookups assume they're unique. Votes, reactions and authors keep their **original user IDs**, so a participant whose browser still has the same identity (`identity.ts`, localStorage) sees their own votes, reactions and cards as theirs.

### Writing (`frontend/src/lib/yboard.ts`)

`importBoard(state, file)` runs in **one `doc.transact`**:
- Pushes every card through `rehydrateCard`, in order, into its column.
- Sets the label, anonymous and autoSort flags with the existing `setBoard*` helpers, and the phase with `setPhase`.
- If the board isn't anonymous, writes `names` into the `names` map. It never overwrites a name already set by someone currently on the board.

### UI flow: import into a new board

1. On the homepage, **Start a new retro** (`NewRetroModal.svelte`) gets an **Import from file…** button (`accept=".json,application/json"`). Available to everyone, signed in or not.
2. Picking a file parses it in the browser right away. The modal shows a preview, for example "23 cards · 41 comments · 57 votes · names restored", plus any warnings. The label field is prefilled from the file and can be edited. A file that fails validation shows the error and nothing is created.
3. On confirm, the existing create flow runs (`POST /api/boards`, which issues the host key in this browser). Then `setPendingImport(slug, file)` writes to sessionStorage, mirroring `setPendingLabel`.
4. On the new board, a host-only, run-once `$effect` in `Board.svelte` runs after the first sync, calls `consumePendingImport(slug)`, then `importBoard(...)`. Like the pending label, it only runs while the board is still empty, so a refresh can't double-import. It takes precedence over the default-anonymous handoff, because the file's anonymous flag wins.

Import always creates a **new** board. It can't overwrite an in-progress retro, and there's no merge UX to design.

## 4. Archives

Archives are the natural server-side source of these files, but today they store too little and, on anonymous boards, too much:

- `endBoard` sends `names: conn.state.namesMap` regardless of the anonymous flag (`Board.svelte`), so archives of anonymous boards hold real names.
- Archives don't record `anonymous`, `phase` or `autoSort`.

Changes (included in the export PR):

- **Client:** `endBoard` sends `anonymous`, `phase` and `autoSort`, and sends `names` only when the board isn't anonymous.
- **Server:** add `anonymous`, `phase` and `auto_sort` to `ArchiveRequest` and `Archive` in `src/archive.rs`, all `#[serde(default)]`, so archives already stored keep loading. The snapshot is a JSON text column, so there's no schema migration.
- **Archive viewer** (`routes/lead/[token]/archives/[id]`) gets a **Download JSON** button that produces the same `.fastretro.json` file. Older archives without an `anonymous` field are exported as anonymous (no names), as the privacy-safe default.

## 5. Testing

- **Unit** (`frontend/src/lib/boardfile.spec.ts`):
  - Round trip: export, parse and import give a deep-equal board, ignoring card and comment IDs. Cover named and anonymous boards.
  - An anonymous export contains no names anywhere in the file, and an anonymous file with injected `names` doesn't restore them.
  - `names` only contains referenced user IDs.
  - Text with commas, quotes, newlines, emoji and leading `=`/`+`/`@` round-trips exactly.
  - An empty board round-trips its label and settings.
  - Wrong `format`, newer `version`, invalid JSON, empty and over-cap files are rejected with the right message.
  - Re-importing the same file regenerates IDs.
- **Rust:** an archive saved without the new fields still loads; a new archive round-trips them.
- **E2E** (`tests/import.spec.ts`, Playwright, through `./test-local.sh` against an isolated instance; never the prod port or DB):
  1. With two browser contexts, build a board with cards in every column, comments, votes, reactions and named authors, and move it to Discuss.
  2. Click **Download JSON**.
  3. In a fresh browser, choose **Start a new retro** → **Import from file…**.
  4. Assert the visible board matches: card text and order per column, vote counts, reactions, comments with author names, label and phase.
  5. Reload and confirm it still matches.
  6. Repeat with an anonymous board and confirm no names appear in the file or on the board.
- `tests/csv-export.spec.ts` is unchanged, since CSV export is unchanged.

## 6. Rollout (suggested PR breakdown)

1. **`feat/json-export`:** `boardfile.ts` export, the Download JSON button, End retro's export-first switched to JSON, the archive fields fix and the archive viewer download, docs update, and tests. Safe to ship on its own, and any file downloaded after it lands can be imported once import ships.
2. **`feat/json-import`:** parser and validation, `importBoard`, the `NewRetroModal` import option, the pending-import handoff, and unit and e2e tests.

## Open items (I'll use these defaults unless you say otherwise)

- **Phase on import:** restore the exported phase, to match "appear the same". The alternative is to always start in Brainstorm.
- **Old CSV files:** not importable. They hold vote and reaction counts but not who voted, and no board settings. Best-effort CSV import can be added later if anyone asks.
- **Anonymous names already stored in archives:** this plan stops new archives from storing them, but doesn't touch existing rows. Scrubbing them would be a one-off data change to the live DB, so I'd do it only with your go-ahead and after a backup.
- **CSV and Excel:** optionally add a UTF-8 BOM to the CSV so Excel shows emoji correctly. One line; I'd fold it into the export PR.
- **"Start from this retro" for archives** (creating a new board straight from an archive, no file): useful, but archive reads are lead-token only today, so it needs an access rule for regular users (e.g. owner or participant). Out of scope for now.
