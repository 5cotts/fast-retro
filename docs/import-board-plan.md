# Plan: import a previously exported board (CSV round-trip)

**Status:** proposal, not implemented yet. Revised 2026-10-29 with Scott's decisions.
**Goal:** a user exports a board to CSV, imports that file later, and gets a board that looks the same as it did at export time: same cards, order, votes, reactions and comments, plus author names when the board isn't anonymous.

## Decisions (from review)

- **CSV only.** There's no JSON export and none is planned; the CSV becomes the full-fidelity format.
- **No Google sign-in required to import.** Anyone who can create a board can import one.
- **Votes and reactions are kept** on import.
- **Author names are restored only when the board isn't anonymous.**

## What exists today

- The **Download CSV** button is host-only, in lead controls. End retro also has an "export first" checkbox. Code: `frontend/src/lib/csv.ts` (`exportCSV`, `csvCell`), `Board.svelte` (`downloadCSV`), `LeadControls.svelte`.
- The current CSV has 5 columns: `column, card_text, votes, reactions, comments`. It is **lossy**:
  - Votes and reactions are counts only; the user IDs behind them are dropped.
  - Comments are joined with ` | `. Authors, timestamps and IDs are dropped, and the join is ambiguous when a comment contains ` | `.
  - The board label, anonymous flag, phase, auto-sort flag, card authors and names map aren't exported.
  - Any cell starting with `= + - @ \t \r` gets a leading `'` (formula-injection guard from PR #11). That isn't perfectly reversible: a card whose text really starts with `'=` can't be told apart from a guarded `=`.
- Board state is a Yjs doc (`board`, `meta`, `names`, `phase`, `timer`). The server (`src/main.rs`) applies any client update unless the board has ended, so writes are client-driven. `yboard.ts` already has `rehydrateCard(snapshot)`, which turns a plain `CardData` object into a `Y.Map` card.
- New boards get their initial label and anonymous flag through a sessionStorage handoff (`setPendingLabel` / `setPendingAnonymous` in `boards.ts`). `Board.svelte` consumes it in a host-only, run-once `$effect` after the first sync.
- Limits: WebSocket message and frame 2 MiB, HTTP body 5 MiB (`MAX_*` in `main.rs`).

**Conclusion:** this is a frontend-only change. No Rust changes are needed.

## 1. New CSV format (v2): human columns plus lossless machine columns

The existing 5 columns stay **first and unchanged**, so the file still reads well in Sheets or Excel. Two machine columns are appended:

```
column,card_text,votes,reactions,comments,card_json,board_json
,,,,,,"{""format"":""fast-retro"",""version"":2,""label"":""Sprint 42"",""anonymous"":false,""phase"":""discuss"",""autoSort"":true,""names"":{""u_abc"":""Alice""}}"
What went well,Shipped the thing,3,👍:2,Nice | Agreed,"{""text"":""Shipped the thing"",""authorId"":""u_abc"",""votes"":[""u_abc"",""u_def"",""u_ghi""],""reactions"":{""👍"":[""u_abc"",""u_def""]},""comments"":[{""text"":""Nice"",""authorId"":""u_def"",""createdAt"":1793238519483}]}"
```

- **Board row:** the first data row has every column blank except `board_json`. It holds `format`, `version`, `label`, `anonymous`, `phase`, `autoSort` and `names`. It's a separate row, rather than living on a card row, so an **empty board** still round-trips its label and settings.
- **Card rows:** one per card, in on-screen order per column. `card_json` holds the exact card: `text`, `authorId`, `votes[]`, `reactions{emoji: userId[]}`, and `comments[{text, authorId, createdAt}]`. Card and comment IDs are left out because they get regenerated on import (see §2).
- **Card order:** the CSV stores the underlying array order, not the vote-sorted display. Sort-by-votes is display-only (`sortedByVotes` in `Board.svelte`), so restoring the array order and the `autoSort` flag reproduces the same view.
- **Anonymous boards:** `names` is **omitted** from `board_json` entirely, so an anonymous board's export never contains real names. Today's CSV doesn't leak them either, so this keeps the current behavior. Author IDs stay, because they're opaque random IDs and are needed for "your card" ownership, vote toggling and reaction toggling.
- **Injection guard:** `csvCell` is still applied to every cell, JSON cells included. The JSON cells always start with `{`, which isn't a formula prefix, so they're never altered. Because the raw text lives inside the JSON, the guard's ambiguity no longer matters for import.
- **Not exported:** timer state, which resets on import, and the ended flag. An imported board is always live and editable.

## 2. Import behavior

### Parsing (`frontend/src/lib/csv.ts`, alongside `exportCSV`)

`parseBoardCSV(text): { board, cards, warnings[] }`:

- Use a proper RFC 4180 parser that handles quoted fields, `""` escapes and newlines inside quotes, all of which the exporter emits. A naive `split(',')` won't work. It's about 40 lines hand-written, or a pinned small library such as `papaparse` if adding a dependency is acceptable. I'd hand-write it to stay dependency-free.
- **v2 files** (with a `card_json` column) use `board_json` and `card_json` as the source of truth.
  - **Spreadsheet edit detection:** if a `card_text` cell no longer equals `csvCell(card_json.text)`, the user edited it in a spreadsheet. In that case, take the edited `card_text` with the guard prefix stripped. Hand edits to card text are kept, and untouched files round-trip exactly.
  - If the `column` cell differs from the original column, the user moved the card in the spreadsheet; use the new column.
- **v1 files** (today's 5-column CSVs, already in users' hands) are imported best-effort, with a warning in the import preview:
  - Columns are mapped by title.
  - The guard is reversed: strip one leading `'` when the next character is in `[=+\-@\t\r]`.
  - Comments are split on ` | `.
  - Vote and reaction counts become placeholder voter IDs (`import:0…N-1`), so the counts look the same. Real users can add votes on top but can't remove the placeholder ones.
- **Validation:** hand-written type guards. Unknown keys are dropped, missing arrays become empty, and rows with an unknown column are skipped with a warning. Anything that isn't a recognizable fast-retro CSV is rejected with a clear message.
- **Caps** (named constants): file ≤ 1 MiB, ≤ 300 cards, ≤ 50 comments per card, text ≤ 2,000 characters. These keep the single import transaction well below the 2 MiB WebSocket frame.
- **Card and comment IDs are regenerated** with `newId()`. Importing the same file twice must not create duplicate IDs, because `mergeCards`, `moveCard` and other id-based lookups assume IDs are unique. Votes, reactions and authors keep their **original user IDs**. A participant whose browser still has the same identity (`identity.ts`, localStorage) sees their own votes, reactions and cards as theirs, which is what "appears the same" requires.

### Writing (`frontend/src/lib/yboard.ts`)

`importBoard(state, parsed)` runs in **one `doc.transact`**:
- It pushes every card through `rehydrateCard`.
- It sets `meta.label`, `meta.anonymous` and `meta.autoSort`, and the phase through `setPhase`.
- If the board isn't anonymous, it writes `names` into the `names` map.

### UI flow: import into a new board

1. On the homepage, **Start a new retro** (`NewRetroModal.svelte`) gets an **Import from CSV…** button. It's available to everyone, signed in or not.
2. Picking a file parses it client-side right away. The modal shows a preview, for example "23 cards · 41 comments · 57 votes · names restored". It also lists any warnings, such as "older CSV format — vote and reaction counts only". The label field is prefilled from the file and can be edited.
3. On confirm, the existing create flow runs (`POST /api/boards`, which issues the host key in this browser). Then `setPendingImport(slug, parsed)` writes to sessionStorage, mirroring `setPendingLabel`.
4. On the new board, a host-only, run-once `$effect` in `Board.svelte` runs after the first sync. It calls `consumePendingImport(slug)` and then `importBoard(...)`. Like the pending label, it runs only when the board is still empty, so a refresh can never double-import. It also takes precedence over the default-anonymous handoff, because the file's anonymous flag wins.

Import goes into a **new** board, never the current one. That way it can't overwrite an in-progress retro, and there's no merge UX to design.

## 3. Testing

- **Unit** (`frontend/src/lib/csv.spec.ts`):
  - v2 round trip: export, parse and import give a deep-equal board, ignoring card and comment IDs. Cover names-on and anonymous boards.
  - An anonymous export contains no names anywhere in the file.
  - Text starting with `=`, `'=`, `+` or `@`, and text containing commas, quotes, newlines, ` | ` and emoji, round-trips exactly.
  - A `card_text` edit made in a spreadsheet is picked up, and an untouched file isn't treated as edited.
  - An empty board round-trips its label and settings.
  - A v1 file imports with the right counts and a warning.
  - Garbage, empty and over-cap files are rejected.
  - Re-importing the same file regenerates IDs.
- **E2E** (`tests/import.spec.ts`, Playwright, through `./test-local.sh` against an isolated instance; never the prod port or DB):
  1. With two browser contexts, build a board with cards in every column, comments, votes, reactions and named authors, and move it to Discuss.
  2. Download the CSV.
  3. In a fresh browser, choose **Start a new retro** → **Import from CSV**.
  4. Assert the visible board matches: card text and order per column, vote counts, reactions, comments with author names, label and phase.
  5. Reload, and confirm it still matches.
  6. Repeat with an anonymous board, and confirm no names appear.
- Update the existing `tests/csv-export.spec.ts` for the new columns. The formula-injection assertions still apply.

## 4. Rollout (suggested PR breakdown)

1. **`feat/csv-v2-export`:** add the `card_json` and `board_json` columns, keep the existing columns unchanged, and update the unit tests and the csv-export e2e test. This is safe to ship on its own, and it means files exported from now on are fully restorable even before import lands.
2. **`feat/csv-import`:** parser, the `importBoard` helper, the `NewRetroModal` import option, the pending-import handoff, unit and e2e tests, and a docs page update (`routes/docs/+page.svelte`, the "Download CSV" bullet).

## Small open items (I'll use these defaults unless you say otherwise)

- **Phase on import:** restore the exported phase. The alternative is to always start in Brainstorm. Restoring matches "appear the same as before".
- **Hand-edited files:** card text and column edits made in a spreadsheet are honored. Edits to the `votes`, `reactions` or `comments` display cells are ignored for v2 files, because the JSON is authoritative there.
- **Excel's 32,767-character cell limit:** a card with a huge comment thread could exceed it if the file is opened and re-saved in Excel. The 50-comment and 2,000-character caps keep `card_json` under about 25k characters in practice. I'll note this in the docs rather than design around it.
