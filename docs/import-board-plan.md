# Plan: import a previously exported board

**Status:** discovery / proposal, not implemented yet. Written 2026-10-29.
**Request:** users want to upload a board they previously exported and get it back as a working board.

## What exists today

The request mentions CSV and JSON export, but only one of those is a user-facing export right now.

| Path | Format | Who | Code |
|---|---|---|---|
| **Download CSV** button (lead controls, plus the "export first" checkbox on End retro) | CSV | Host only | `frontend/src/lib/csv.ts` (`exportCSV`), `Board.svelte` (`downloadCSV`), `LeadControls.svelte` |
| Archive snapshot written on **End retro** | JSON (in SQLite `archives.snapshot`) | Host, through `/lead/:token/archives` | `src/archive.rs` (`Archive`, `BoardCardsSnapshot`), `GET /api/archives/:id` |

The archive JSON is only reachable through the API and the read-only archive viewer. There's no **Download JSON** button. If users talk about a "JSON export", they're probably copying the `/api/archives/:id` response or reading the archive page, so this plan adds a real JSON export too.

### What the CSV keeps and drops

The CSV header is `column, card_text, votes, reactions, comments`:

- `column` is the display title (`What went well`, `What to improve`, `Action items`), not the `ColumnKey`.
- `votes` is a count only. Voter IDs are dropped.
- `reactions` is `emoji:N` joined by spaces. Reacting user IDs are dropped.
- `comments` holds the comment texts sorted by `createdAt` and joined by ` | `. Authors, timestamps and IDs are dropped. The join is ambiguous when a comment itself contains ` | `.
- Any cell starting with `= + - @ \t \r` gets a leading `'` (formula-injection guard from PR #11).
- The board label, anonymous flag, phase, names map and card authors aren't exported.

That means a CSV can only be restored on a best-effort basis. A JSON file can round-trip almost everything.

### What the JSON archive keeps

`Archive` contains `{ id, slug, label, endedAt, cards: { wentWell, toImprove, actions }, names }`. Each card is `{ id, text, authorId, votes[], reactions{emoji: userId[]}, comments[{id, text, authorId, createdAt}] }`, which matches the frontend `CardData` type exactly. It has no format version and no phase or anonymous flag.

## How board state is written (and why import can be client-side)

- Board content is a Yjs doc (`board`, `meta`, `names`, `phase`, `timer` maps). The server (`src/main.rs`, `src/sync.rs`) treats it as an opaque CRDT. It applies any update from any connected client unless the board has ended, then persists and broadcasts it. Nothing on the server checks the card schema or who the lead is for doc writes.
- `yboard.ts` already has `rehydrateCard(snapshot)`, which builds a full `Y.Map` card from a plain `CardData`-shaped object. `moveCard` uses it today. Import can use it directly.
- New boards get their initial label and anonymous flag through a sessionStorage handoff: `setPendingLabel` / `setPendingAnonymous` in `boards.ts`. `Board.svelte` consumes them in a host-only `$effect` after the first `provider.once('sync')`. Import can reuse the same handoff.
- Limits: HTTP body 5 MiB, WebSocket message and frame 2 MiB (`MAX_*` in `main.rs`). A single import transaction has to stay well under 2 MiB.

**Conclusion:** import fits as a frontend-only feature. The file gets parsed in the browser, normalized to `BoardCardsSnapshot`, and written to a new board's doc in a single `doc.transact` once the host's provider has synced. No new endpoint and no Rust changes are needed for v1.

## Proposed design

### 1. Add a versioned JSON export (prerequisite)

- Add `frontend/src/lib/boardFile.ts` with `exportBoardJSON(state)`. It produces:
  ```json
  {
    "format": "fast-retro-board",
    "version": 1,
    "exportedAt": 1793238519483,
    "label": "Sprint 42",
    "anonymous": true,
    "cards": { "wentWell": [], "toImprove": [], "actions": [] },
    "names": { "<userId>": "Alice" }
  }
  ```
  `cards` uses the existing `CardData` shape.
- Add a **Download JSON** button next to **Download CSV** in `LeadControls.svelte` (both the desktop and mobile variants). Call it **Export** and offer CSV and JSON if the toolbar gets crowded.
- Add **Download JSON** to the archive detail page (`/lead/:token/archives/:id`), built from the `Archive` it already fetches. This makes past retros importable too.
- Import also accepts a bare `Archive` object (no `format` key, but it has `cards`) for compatibility with archives users already have.

### 2. Parsing and normalization (`boardFile.ts`)

`parseBoardFile(name, text): { label, anonymous?, cards, warnings[] }`, with these rules:

- **Detect format** by the `format` key, then `Archive` shape, then a CSV header row. Anything else is rejected with a clear error.
- **JSON:** validate with hand-written type guards. The frontend has no zod, so I'd avoid adding a dependency for this. Drop unknown keys. Coerce missing arrays to empty.
- **CSV:** use a real RFC 4180 parser (quoted fields, `""` escapes, embedded newlines). The current exporter can emit all three, so `split(',')` won't work. Then:
  - Map `column` by title, and also accept the `ColumnKey` and case-insensitive variants. Rows with an unknown column are skipped with a warning.
  - Reverse the injection guard: strip one leading `'` only when the next character is in `[=+\-@\t\r]`. That exactly inverts `csvCell`.
  - Split `comments` on ` | ` into separate comments (documented as lossy). Use the import time as `createdAt` and keep the order.
  - Votes and reactions only come back as counts (see the open question below).
- **Regenerate all card and comment IDs** with `newId()`. Re-importing the same file, or importing into a board that came from it, must not create duplicate IDs. `mergeCards`, `moveCard` and other id-based lookups assume IDs are unique.
- **Caps** (reject the file, or truncate with a warning): file ≤ 1 MiB, ≤ 300 cards, ≤ 50 comments per card, text ≤ 2,000 characters. Each cap gets its own constant. These keep the import transaction far below the 2 MiB WebSocket frame limit. There's no existing max card length in the UI. One is worth adding separately, and import should match it.
- Imported text is only ever rendered through Svelte's escaped interpolation. There's no `{@html}` in the codebase, so this adds no new XSS surface. The CSV injection guard still applies on re-export.

### 3. Where import lives in the UI

**Recommended (v1): import into a new board.** On the homepage, **Start a new retro** gets an **Import from file…** option (`NewRetroModal.svelte`). The flow:

1. The user picks a `.json` or `.csv` file. It gets parsed client-side right away, and the modal shows a preview ("23 cards, 41 comments · 2 warnings") plus a label prefilled from the file.
2. On confirm, the existing create flow runs (`POST /api/boards`, which issues the host key). Then `setPendingImport(slug, normalized)` writes to sessionStorage, mirroring `setPendingLabel`.
3. In `Board.svelte`, a new host-only, run-once `$effect` (same pattern as the pending label and anonymous effects) runs after sync. It calls `consumePendingImport(slug)` and then `importCards(doc, board, cards)` in a single `doc.transact`, using `rehydrateCard`. It applies the label and anonymous flag from the file unless the user overrode them in the modal.
4. The board starts in **Brainstorm** with the timer reset, regardless of the phase at export time.

Why a new board rather than overwriting the current one:

- It can't destroy an in-progress retro.
- There's no merge or conflict UX to design.
- It's the natural mental model for "upload my old board".

**Optional follow-up:** an **Import cards** button in lead controls that *appends* into the current board. It would be enabled only when the board isn't ended, behind a confirm dialog. That covers carrying last sprint's action items into a fresh retro. I'd hold it until v1 ships and see whether people ask for it.

### 4. Server changes

None are required for v1. Optional hardening, as separate PRs:

- Lower the per-route `RequestBodyLimitLayer`. This only matters if a server-side import endpoint is ever added.
- Server-side enforcement of host-only writes doesn't exist for *any* doc mutation today. Import doesn't make that worse, so it's out of scope here.

Rejected alternative: `POST /api/boards` with a `seed` payload, where Rust builds the Yrs doc. The benefit is that the board is fully populated before anyone connects, so there's no window where the host's tab must stay open until the import syncs. The cost is duplicating the card schema in Rust and keeping it in sync with `yboard.ts`. It's not worth it for v1. The sessionStorage handoff already has the same "host's tab applies it" property as the pending label, and that has been fine.

## Testing

- **Unit** (`frontend/src/lib/boardFile.spec.ts`, vitest):
  - JSON export → parse round-trip is lossless, apart from IDs.
  - CSV export → parse round-trip keeps text, columns, comment text and counts.
  - Formula-guard reversal works: `'=SUM(A1)` becomes `=SUM(A1)`, and `'hello` stays `'hello`.
  - Quoted, multiline and doubled-quote CSV fields parse correctly.
  - Bare `Archive` JSON is accepted.
  - Garbage, empty files and over-cap files are rejected with useful errors.
  - IDs are always regenerated.
- **E2E** (`tests/import.spec.ts`, Playwright, run through `./test-local.sh` against an isolated instance):
  1. Create a board, add cards, a comment, a vote and a reaction.
  2. Download the JSON.
  3. On the homepage, choose **Start a new retro**, then **Import from file**.
  4. Assert the new board has the same cards and comments, a second participant sees them live, and reloading persists them.
  5. Repeat with the CSV file.
  6. Confirm a formula-prefixed card survives CSV export → import → export unchanged.

## Rollout steps (suggested PR breakdown)

1. `feat/export-json`: `boardFile.ts` export, a **Download JSON** button on the board and the archive page, and unit tests.
2. `feat/import-board`: parser, normalization, the `NewRetroModal` import option, the pending-import handoff, the `importCards` helper in `yboard.ts`, unit and e2e tests, and a docs page update (`routes/docs/+page.svelte`, the "Download CSV" bullet).
3. (Optional) `feat/import-into-current-board`: the append flow, if people ask for it.

## Open questions for Scott

1. **Restore or template?** Should an imported board keep **votes and reactions**, or start fresh with just cards and comments?
   - Keeping them makes sense for "restore my board".
   - Starting fresh makes sense for "reuse last retro's items".
   - **My recommendation:** keep them for JSON, behind a "Keep votes & reactions" checkbox that defaults on. Imported voter IDs belong to the original participants, so current participants can add their own votes but can't remove the old ones.
   - For CSV, votes are only counts. Either drop them, or synthesize placeholder voter IDs (`import:0..N-1`) so the counts show. I'd drop them for CSV and show a warning.
2. **CSV support at all?** Supporting JSON only is simpler and lossless, but the only export users have *today* is CSV. I'd ship both and label CSV import as best-effort.
3. **Who can import?** The plan assumes anyone who can create a board. That's everyone, rate-limited, because board creation is open. Should import require Google sign-in?
4. **Author names:** with JSON, should the `names` map be restored? It would show the original authors' names on cards, but those names would belong to user IDs that aren't present on the new board. My recommendation is to restore names only when the imported board isn't anonymous.
