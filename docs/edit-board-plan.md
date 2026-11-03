# Plan: edit a board after it's created ("setup mode")

Status: discovery, awaiting decisions · 2026-11-03 · checked against `main` at `e5c7427`

## Goal

A host who has already created a board can go back and change what they chose in **Start a new retro**: add a column they forgot, rename, reorder or remove columns, turn Action items on or off, and adjust the board's options. Today the columns are fixed once the board exists.

## Why

User feedback after custom columns shipped: "I make the board, I realize I'm missing a thing or want to tweak things or options, and it's locked." The fix today is to throw the board away and create a new one, which also means sending a new link to everyone.

Competitors treat this as basic:

- **EasyRetro:** the board owner can add, remove, rename and recolor columns at any time, including deleting a column that has cards in it. Board options live in a settings sidebar that's always available to the owner. \[1\]\[2\]\[3\]
- **Easy Agile TeamRhythm** has an **Edit setup** screen on an existing retro: add, remove and reorder columns, and rename any of them. A column that has items can't be removed. \[4\]

## What's locked today and what isn't

| Chosen at creation | Editable afterwards? | Where |
| --- | --- | --- |
| Board name | ✅ host clicks the name | `BoardLabel.svelte` → `setBoardLabel` |
| Hide others' cards | ✅ header toggle | `LeadControls` `TOGGLES` → `setBoardSetting` |
| Anonymous (on by default, not in the dialog) | ✅ header toggle | same |
| Auto-sort (not in the dialog) | ✅ header toggle | same |
| **Retro vs. Custom, column names, count, order** | ❌ | written once by `seedBoard` |
| **Action items column** | ❌ | written once by `seedBoard` |

So the real gap is **columns**. The options can already be changed, but only as separate header buttons with different wording from the dialog. A host who thinks of the board as "what I set up in that dialog" won't connect the two. That's a discoverability problem, and the same fix covers it.

## Proposal

**An "Edit board" dialog for the host, available until the board ends.** It's the creation dialog again, pre-filled with the board's current state:

- **Name**
- **Columns:** the current list, editable. Rename in place, add, remove, and move up or down. Classic boards show their three columns here too, so a classic board can become a custom one just by editing it. There's no separate Retro/Custom switch, because Retro is just a preset list.
- **Action items column** checkbox
- **Options:** Hide others' cards, Anonymous, Auto-sort (driven by the existing settings registry)
- **Save** applies everything in one shot, so participants see a single change instead of a series of flickers.

The entry point is an **Edit board** button (gear icon) next to the host's other header controls, plus an item in the mobile menu. The header toggles stay as they are, for quick changes mid-session.

**Why a dialog and not a separate Setup phase.** A literal Setup phase (participants can't add cards until the host clicks Start) would add a step to every retro, and it wouldn't help when the host notices a missing column 5 minutes into Brainstorm, which is the situation described in the feedback. An edit dialog available in every phase covers both cases. A "hold participants until I'm ready" gate can be added later if someone asks for it (see S1).

### Behavior details

- **Rename / reorder:** cards stay put. Column keys are random and never derived from titles (`newCustomColumns`), so only the title or position changes.
- **Add a column:** it appears for everyone at once and gets the next palette color. People can add cards to it whenever input columns are open (Brainstorm), like any other column.
- **Remove a column that has cards:** the dialog shows a warning before Save, for example "Removing *Pricing* deletes its 4 cards." On Save, those cards are deleted (S2).
- **Turn Action items off** while it has cards: same warning. If the board is in the Actions phase, it moves to Discuss in the same change, because a board without Action items ends at Discuss (`phasesFor`).
- **Turn Action items on:** the column comes back as the last column, empty unless it still has cards from before (see "Clear, don't delete" below).
- **Participants** see the change live. If someone was typing in a column that gets removed, their unsent text is lost, so show a short notice: "The host changed the columns."
- **Not allowed:** removing every input column (Save stays disabled, same rule as the creation dialog). Editing after the board has ended (the server already drops those writes).

## Engineering design

### Data: no new storage, no server change

The column list is already a plain JSON array at `meta.columns`, read through `sanitizeColumns` (untrusted input, cleaned on read). Cards live in `board.<columnKey>` Y.Arrays. Editing means:

1. writing a new `meta.columns` list (or deleting the key if the result equals `DEFAULT_COLUMNS`, so a classic board stays "no list stored"),
2. making sure every listed column has an array, and
3. clearing the arrays of removed columns,

all in **one `doc.transact`**.

**Not affected:** the server (`sync.rs` card count is already generic, and archives take their columns from the client at end time), board files and CSV (export reads the live `conn.state.columns`), archives, and the settings registry. No file format version bump, no migration.

### Clear, don't delete, removed columns' arrays

When a column is removed, empty its Y.Array (`arr.delete(0, arr.length)`) but leave the array in the `board` map. Reasons:

- **Two host tabs saving at once.** `meta.columns` is one last-writer-wins value. If tab A removes column X while tab B saves a list that still contains X, and A had *deleted* X's array, B's list would win and X would show with no array behind it. `addCard` silently does nothing on a column with no array, so that column would be broken for everyone. With clear-not-delete, X just comes back empty.
- **Turning Action items back on** reuses the existing `actions` array instead of creating a second one under the same key. Creating the same key from two clients is exactly the race documented in `createBoard`.
- **Stray empty arrays are already harmless:** `readAllCards` returns them, but every renderer and exporter picks keys from the column list.

New columns always get fresh random keys, so only the editing client ever creates their arrays. That avoids the same-key race.

Known edge case: if a participant adds a card to a column at the same moment the host removes it, the card survives in the now-hidden array (a concurrent Y.Array insert isn't covered by the delete). It's invisible and not exported, but it's still counted by `sync.rs`'s card count on the lead dashboard. That's rare, and harmless enough to accept.

### Code shape

Keep the logic pure and testable, and reuse the creation dialog instead of copying it.

1. **`columns.ts`: `editColumns(current, rows, { actionItems })`.** `rows` is `{ key?: string; title: string }[]` in display order. Rows with a key keep that key and its color; rows without one get a fresh `c-…` key and the next palette color. Runs through `sanitizeColumns` like everything else. Plus `diffColumns(prev, next) → { added, removed }`.
2. **`yboard.ts`: `applyBoardEdit(state, { label, columns, settings })`.** One transaction: label, settings, `meta.columns`, ensure arrays for `added`, clear arrays for `removed`, and move the phase from `actions` to `discuss` if Action items went away. This is the only writer, so the rules live in one place.
3. **`ColumnEditor.svelte`**, extracted from `NewRetroModal.svelte`: the row list (stable row ids, add/remove, focus handling), plus move up/down and an optional per-row card count for the removal warning. `NewRetroModal` uses it unchanged in behavior. Rows carry an optional `key`, so the same component edits existing columns.
4. **`EditBoardModal.svelte`:** name, `ColumnEditor`, Action items checkbox, option checkboxes generated from `BOARD_SETTING_KEYS`, a removal warning, Save/Cancel. It reads its initial state from `conn.state` when opened and doesn't re-sync while open (the host is the only editor).
5. **`Board.svelte` / `BoardHeader.svelte`:** an `onEditBoard` handler gated on `effectiveLead` (host and not ended), like the other lead handlers, and a "The host changed the columns" notice for participants when a column they had a draft in disappears.
6. **Analytics:** a `board_edit` event with `{ added, removed, renamed, reordered, settingsChanged }` counts. This tells us whether people mostly fix typos or restructure.

Move up/down buttons first, because they're keyboard-accessible and simple. Drag-to-reorder columns can come later.

## Rollout: 3 stacked PRs (+ this doc)

| PR | Content | Behavior change |
| --- | --- | --- |
| 0 | This plan | none |
| 1 | Extract `ColumnEditor.svelte` from `NewRetroModal` (rows with optional key, move up/down hidden for creation). | none: the existing new-retro e2e specs must pass untouched |
| 2 | `editColumns`, `diffColumns`, `applyBoardEdit` + unit tests (no UI yet). | none |
| 3 | `EditBoardModal`, header and mobile entry points, participant notice, analytics, docs page, e2e tests. | the feature |

Each PR runs the full unit suite, `svelte-check`, the Rust tests and `./test-local.sh` (never against prod), the same as the custom-columns stack.

### Tests

- **Unit (PR 2):** rename keeps the key and color; reorder keeps keys; a new row gets a fresh key and color; a classic board edited back to the default columns stores no list; removing a column clears its array but keeps it; re-adding Action items reuses the array; removing Action items while in Actions moves the phase to Discuss; two edits from two `Y.Doc`s merged in either order never leave a listed column without an array.
- **E2E (PR 3):**
  - The host adds a column mid-Brainstorm, and a second browser sees it and can add a card to it.
  - Renaming keeps cards.
  - Removing a column with cards shows the warning, and the cards are gone after Save.
  - Toggling Action items off in the Actions phase lands the board in Discuss.
  - Non-hosts and ended boards have no Edit button.
  - Export after an edit contains the new columns.
- **Scenario:** extend `docs/qa-brainstorm-scenario.md` (and its spec) with "realize you forgot a problem statement, add it from Edit board."

## Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| S1 | Edit-anytime dialog, or a real Setup phase that blocks participants until the host starts? | **Edit-anytime dialog.** Revisit a "hold participants" gate only if asked. |
| S2 | Removing a column with cards: delete with a warning, block it (TeamRhythm), or ask where to move the cards? | **Delete with a warning** (EasyRetro). It's the least UI, and the warning says how many cards. "Move cards to…" can be added later. |
| S3 | Allow editing in every phase, or only in Brainstorm? | **Every phase.** Adding a column during Vote is harmless (it just stays empty), and blocking it would be surprising. |
| S4 | Is the gear-icon dialog enough, or also inline rename by clicking a column title? | **Dialog only for now.** Inline rename is a small follow-up once the edit path exists. |

## Open question for the requester

Was the pain only about columns, or also about the options? The options can already be changed from the header, so if they were missed too, that confirms the discoverability fix (one Edit board dialog) matters as much as unlocking the columns.

## Sources

1. EasyRetro Update 1 (owner can add/remove/rename/recolor columns): https://easyretro.io/blog/funretro-update-1
2. EasyRetro changelog (delete a column with cards, clear a column): https://easyretro.io/whats-new
3. EasyRetro board settings explained: https://intercom.help/easyretro/en/articles/6476873-easyretro-s-board-settings-explained
4. Easy Agile TeamRhythm, configuring a retrospective ("Edit setup"): https://help.easyagile.com/easy-agile-teamrhythm/configuring-retrospective-board
