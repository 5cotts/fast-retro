# Plan: custom columns and hidden cards

Status: approved, in progress · 2026-11-02

## Goal

Let a host run a brainstorm on fast-retro, not just a retro: any number of named columns (for example, one per problem statement), people writing privately during Brainstorm, then everything revealed at once and grouped as usual.

## Why

A user wanted to run a brainstorm: five problem statements, ten minutes of private writing, then reveal, group and discuss. fast-retro only has the three fixed retro columns and shows every card as soon as it's added, so they ran it in EasyRetro instead. They said custom columns alone would have been enough; private writing is implied by the flow.

Competitors: EasyRetro has owner-editable columns and a "Hide cards" setting. Spreo (formerly Metro Retro) is a free-form canvas with per-sticky private writing and "Topics" clusters. Custom columns and private writing are table stakes; cross-column clusters are a differentiator and are deferred.

## Decisions (Scott, 2026-11-02)

- **D1:** no product limit on columns. A hidden safety ceiling of 50 input columns guards against junk in the (untrusted) doc.
- **D2:** custom boards always include the Action items column.
- **D3–D9:** go with the recommendations in the table below (Scott said to start building with them; any can still change in review).


Written for whoever implements this. Everything here was checked against `main` at `5ad134b`. Function names are given instead of line numbers because line numbers drift.

### TL;DR

- Ship in **6 PRs**: 1 docs, 2 refactors with no behavior change, 3 features. Clustering comes later and isn't planned in detail.
- **Make the change easy, then make the easy change.** Most of the risk is in two refactors: turning "columns" into data instead of three hard-coded keys, and creating every new board through one seeding path. After those, custom columns and hidden cards are mostly additive.
- **Server changes are small:** the archive snapshot becomes a map keyed by column, plus a generic card count. There's no sync or protocol change and no DB migration.
- **Compatibility:** a board with no column list is a classic three-column board, so existing boards, archives and v1 board files keep working with no migration.

### What the code looks like today (findings that shape the design)

1. **The column list is hard-coded in about 20 places.**
   - **Frontend:**
     - `types.ts`: `ColumnKey` union, `COLUMNS`, `COLUMN_EMPTY_HINT`, `COLUMN_PLACEHOLDER`.
     - `yboard.ts`: `createBoard` sync handler, `resetBoard`, `isBoardEmpty`, `importBoard`.
     - `useBoardConnection.svelte.ts`: initial state and `recomputeCards`.
     - `phase.ts`: `canAddCardInColumn` switches on key names.
     - `boardfile.ts`: `copyCards`, `parseBoardFile`, `boardFileFromArchive`, `BoardFile.cards` type.
     - `csv.ts`.
     - `Board.svelte`: `drafts` init, `cardCount`, `carryOverFile`, import analytics count, `md:grid-cols-3`, the `'actions'` footer text.
     - `routes/lead/[token]/archives/[id]/+page.svelte`.
   - **Backend:**
     - `sync.rs` `read_summary`: card count.
     - `archive.rs` `BoardCardsSnapshot`: three named fields, used in `card_count` and `top_voted_text`.
2. **The code that turns a Yjs card into a plain card is copied 4 times.** `readCards`, the `moveCard` snapshot, the `mergeCards` source read and `rehydrateCard` each parse or build card and comment maps by hand. Adding any card field (hidden state now, `groupId` for clusters later) means editing all four. Centralizing this is cheap and pays off right away.
3. **New-board setup is spread out, and the two creation paths have drifted apart.**
   - There are three sessionStorage handoffs in `boards.ts`: `setPendingLabel`, `setPendingAnonymous` and `setPendingImport`.
   - `Board.svelte` has three run-once host-only `$effect`s that consume them.
   - Three callers build the handoff: the home page `onNewConfirm`, the host dashboard `onNewConfirm` and `Board.svelte` `startNextRetro`.
   - The host dashboard path never calls `setPendingAnonymous`, so boards created there aren't anonymous by default, while home-page boards are. This is probably unintended; see decision D7.
   - Adding "columns" and "hide cards" as two more handoffs would make five effects. It would also hit an ordering bug: `createBoard`'s on-sync handler creates the default `wentWell`/`toImprove`/`actions` arrays *before* any pending setup runs.
4. **Each board setting is hand-rolled.** `anonymous` and `autoSort` each have a read/set pair in `yboard.ts`, a field in connection state, a field in `BoardFile.board`, a field in the archive request, and two copies of a toggle button in `LeadControls.svelte` (full and compact layouts). A third setting means seven more copies of the same pattern.
5. **`Board.svelte` is 1,340 lines.** The column markup (header, card list, drop targets, composer) is about 140 lines inline in one `{#each COLUMNS}`. Both features touch it.
6. **Trust model.** Any connected client can write any part of the Yjs doc. "Host only" is enforced in the UI, not on the server; the server only blocks writes to ended boards. Column definitions read from the doc are therefore **untrusted input** and must be validated on read, the same way `parseBoardFile` treats files.
7. **The Y.Map race is real and already documented.** See the comment in `createBoard`: two clients creating the same `board` key at the same time means one array, and its cards, is lost. Any design that creates column arrays lazily (for example, on the first card added) brings this bug back.
8. **The repo is public.** Keep user feedback (screenshots, names) out of committed docs.

### Design

#### 1. Columns are data: `frontend/src/lib/columns.ts`

```ts
export type ColumnColor = 'emerald' | 'amber' | 'sky' | 'violet' | 'rose' | 'teal' | 'orange';
export interface ColumnDef { key: string; title: string; color: ColumnColor }

export const ACTIONS_COLUMN_KEY = 'actions';
export const isActionsColumn = (c: ColumnDef) => c.key === ACTIONS_COLUMN_KEY;

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'wentWell', title: 'What went well', color: 'emerald' },
  { key: 'toImprove', title: 'What to improve', color: 'amber' },
  { key: 'actions', title: 'Action items', color: 'sky' }
];

export function sanitizeColumns(raw: unknown): ColumnDef[] | null; // used by readColumns and parseBoardFile
export function readColumns(meta: Y.Map<unknown>): ColumnDef[];  // meta.columns, sanitized, else DEFAULT_COLUMNS
export function newCustomColumns(titles: string[]): ColumnDef[]; // fresh keys + palette + actions last
export const COLUMN_STYLE: Record<ColumnColor, { accent: string; header: string; dot: string }>;
export const BOARD_TEMPLATES = [{ id: 'retro', name: 'Retro', columns: DEFAULT_COLUMNS }, { id: 'custom', name: 'Custom' }];
```

**Invariants:**

- **Keys are stable IDs, not slugs of titles.** A future rename then never moves cards. Custom keys are `c-` plus 6 random characters (reuse `newId()`) and must match `/^[A-Za-z0-9_-]{1,32}$/`.
- **The Action items column always exists, is last, and its key is** `actions`**.** "Is this the actions column" is `isActionsColumn`, the only place that knows this. This avoids a separate `kind` field and rules out states like "two actions columns". Carry-over, the Actions phase gate and the footer text all go through `isActionsColumn`.
- `sanitizeColumns` **cleans the list rather than rejecting it.**
  - Drop entries with bad keys or empty titles, and dedupe keys.
  - Trim titles to the max length, and assign a palette color by position if the color is missing or unknown.
  - Force `actions` to the end, adding it if missing.
  - Fall back to `DEFAULT_COLUMNS` only when no input column survives.
  - Keep at most `MAX_INPUT_COLUMNS` (50) input columns and drop the rest. This is a safety ceiling for untrusted doc data, not a product limit (D1); the creation UI never shows it.
  - Rejecting the whole list would hide every card on the board because of one bad entry.
- **Colors are tokens, not Tailwind classes.** `COLUMN_STYLE` holds full literal class strings, because the Tailwind JIT can't see `bg-${c}-50`. Input columns cycle emerald → amber → violet → rose → teal → orange. Sky is reserved for Action items so it stays visually distinct.
- **Hints are presentation, not data.**
  - The two legacy input keys keep their current empty hints.
  - Custom columns get a generic "Nothing here yet — add the first idea."
  - `COLUMN_PLACEHOLDER` is the same string for every column today, so it becomes one constant.

`phase.ts`: `canAddCardInColumn(col: ColumnDef, phase)` returns `isActionsColumn(col) ? phase === 'actions' : phase === 'brainstorm'`.

#### 2. Storage in the Yjs doc

- **Column list:** `meta.columns` holds a plain JSON array of `ColumnDef`, stored as a Y `Any` value so it's written and replaced in one step. Only the board seed writes it in v1. A later "rename column" feature replaces the whole array; last write wins, which is fine for a host-only edit.
- **Cards:** stay in the `board` Y.Map keyed by column key, so extra columns are just more keys.
- **Invariant: a column and its empty** `Y.Array` **are always created in the same transaction.** Peers then never see a column without its array, so nobody creates one lazily and the race in finding 7 can't happen. `createBoard`'s on-sync "ensure arrays" loop stays as a safety net, but it iterates `readColumns(meta)` and runs *after* the seed (see §3).
- **Readers use the column list.** Rendering, exporting and archiving always iterate `columns`, never `board.keys()`. Stray arrays (for example, legacy defaults made by a participant who joined before the host's seed landed) are harmless and invisible.
- **Card state:** `state.cards` becomes `Record<string, CardData[]>`, built by reading every array in `board`. The UI looks up `cards[col.key] ?? []`, and `state.columns` comes from `recomputeMeta`. This keeps card state independent of the column list, so a change to `meta.columns` needs no special re-wiring.
- **Whole-board helpers:** `countCards(cards)` and `isBoardEmpty(board)` look at *all* arrays.
- **Card codec:** add `cardFromY(map): CardData | null` and `cardToY(card): Y.Map`, with comment equivalents, in `yboard.ts` or a small `cardcodec.ts`. `readCards`, `moveCard`, `mergeCards` and `importBoard` all use them (finding 2).

#### 3. One way to create a board: the seed

**Every new board is seeded from a** `BoardFile`**.** That covers a blank board, a file import and next-retro carry-over. A blank board is a `BoardFile` with zero cards.

- **Why reuse** `BoardFile`**:** it's already validated (`parseBoardFile`), versioned, serializable for sessionStorage, and applied by `importBoard` in one transaction.
- **Handoff:** `boards.ts` replaces the three pending APIs with `setPendingSeed(slug, file, origin)` and `consumePendingSeed(slug)`.
  - `ImportOrigin` gains `{ kind: 'new' }`.
  - `importBoard` becomes `seedBoard` and only writes the `importedAt`/`importedKind` meta when the origin is not `new`.
- **Builder:** `newBoardSeed({ label, anonymous, columns?, hideCards? })` is the one place that builds a blank seed. All three callers use it.
- **When it runs:**
  - It's applied in `createBoard`'s on-sync handler, in the **same transaction** as the ensure-arrays loop: seed first, then ensure arrays.
  - `conn.start` takes a `takeSeed?: () => SeedOrNull` callback. `Board.svelte` passes `() => consumePendingSeed(slug)` only when `isLead`.
  - Consuming inside the sync handler (not before connecting) means a refresh before the first sync doesn't lose the seed.
- **Guard:** apply only if `isBoardEmpty(board) && !meta.has('columns')`. That's equivalent to today's "empty board" check for imports and "unnamed board" check for labels.
- **Cleanup:** this removes the three `pending*` effects from `Board.svelte`.

#### 4. File formats, archive and server

- **Board file v2** (`boardfile.ts`):
  - `board` gains `columns: ColumnDef[]`. `cards` becomes `Record<string, CardData[]>` keyed by those column keys.
  - Export always writes v2 with an explicit column list.
  - Import accepts v1 (columns = `DEFAULT_COLUMNS`, exactly as today) and v2 (columns via `sanitizeColumns`). Cards under keys not in the list are dropped with a warning.
  - **Versioning rule (write it in the file's header comment): bump the version only when an older reader would silently lose data.** Custom columns qualify: an old build would drop those cards, so it should refuse the file with `newer_version`. Optional settings such as `hideCards` are additive and don't bump the version.
  - Add a frozen v2 fixture and spec next to `boardfile-v1.spec.ts`, and keep the v1 fixture test unchanged.
- **CSV:** `exportCSV(columns, cards)`. Column titles are now user input, so confirm they go through `csvCell` (they already do, since every cell does) and add a formula-injection test for a title like `=HYPERLINK(...)`.
- **`archive.rs`:**
  - `BoardCardsSnapshot` becomes `#[serde(transparent)] struct BoardCardsSnapshot(BTreeMap<String, Vec<CardSnapshot>>)`. The JSON is identical for legacy archives, so existing rows in `archives.snapshot` load unchanged.
  - Add `columns: Option<Vec<ColumnSnapshot>>` (`key`, `title`, optional `color`) to `ArchiveRequest` and `Archive`, with `skip_serializing_if` matching the existing optional fields.
  - `card_count` and `top_voted_text` iterate `values()`.
  - In `save`, reject requests with more than 51 column keys (50 input columns plus Action items), keys that don't match the regex, or titles longer than the max length. The endpoint is host-gated, but the check is cheap.
  - Keep the existing tests, including the partial `{ "wentWell": [] }` case, and add: custom keys round-trip, legacy row loads, card count across custom keys.
- **`sync.rs`** `read_summary`**:** sum the lengths of every `YArray` in `board`, with no column names. Add a unit test.
- **Frontend archive consumers:** `ArchiveLike` and `boardFileFromArchive` gain `columns`, and the archive viewer page renders `archive.columns ?? DEFAULT_COLUMNS` using `COLUMN_STYLE`.
- **Carry-over (**`carryOverFile`**):** the next retro **inherits the board's column list**; see D6. Only the actions-column cards carry over, as today.

#### 5. Board layout for N columns

- **`BoardColumn.svelte`:** extract the column `<section>` from `Board.svelte` (header, card list, drop targets, composer). It takes `column: ColumnDef` plus the existing callbacks and drag state as props. Drag state stays in `Board.svelte`; the column only renders it.
- **Grid:**
  - Mobile stays one stacked column.
  - At `md+` with ≤ 4 columns: `grid-template-columns: repeat(N, minmax(0, 1fr))`, set through an inline CSS variable because Tailwind can't generate dynamic `grid-cols-N`. Three columns must look pixel-identical to today.
  - With ≥ 5 columns: `grid-auto-flow: column; grid-auto-columns: minmax(17rem, 1fr); overflow-x: auto` with scroll snap, and the container widens past `max-w-7xl`.
- **Long titles:** column titles are problem statements for brainstorm boards ("How might we cut onboarding time for new hires?" is about 50 characters). Headers wrap, with no truncation and a `title` attribute.
- **Small fixes:** `drafts` becomes `Record<string, string>` read as `drafts[key] ?? ''`. The current `drafts[col.key].trim()` would throw on an unknown key. `neighborColumn` keyboard navigation uses `state.columns`.

#### 6. Hidden cards while brainstorming

- **Visibility rule:** a pure function in `frontend/src/lib/visibility.ts`, unit-tested with no DOM:

  ```ts
  export function isCardHidden(card: CardData, column: ColumnDef,
    ctx: { hideCards: boolean; phase: Phase; ended: boolean; userId: string }): boolean {
    return ctx.hideCards && ctx.phase === 'brainstorm' && !ctx.ended
      && !isActionsColumn(column) && card.authorId !== ctx.userId;
  }
  ```

- **Why each condition:**

  - **The Action items column is never hidden.** Otherwise carried-over action items, written by last sprint's authors, would be hidden from the team that's meant to review them.
  - **Ended boards are never hidden.** A host can end a retro while still in Brainstorm, and the frozen board must stay readable.
  - **Going back from Group to Brainstorm hides cards again.** That's consistent and needs no extra state; see D5.
  - **The host is hidden too, with no peek in v1;** see D4.

- **Rendering:**

  - Hidden cards render as `HiddenCard.svelte`, a placeholder with **no card text in the DOM**. CSS blur over real text is readable, copyable and exposed to screen readers.
  - Drag, edit, delete, reactions and comments are off for hidden cards, including the host's override that normally lets them edit any card.
  - Column counts still include hidden cards, so people can see that others are writing.
  - Typing indicators are unchanged.

- **Reveal:** leaving Brainstorm reveals all cards at once, with no extra button.

  - Add a one-line banner while hiding is on: "Cards are hidden until the Group phase."
  - Put the limitation in the toggle's tooltip: "Stops people from being influenced by others' ideas. It isn't a security feature."

- **Known gap:** host export during Brainstorm includes every card's text. Accept it; it's the same "prevents anchoring, not snooping" limit.

- **Settings registry** (first commit of this PR), in `yboard.ts` or a new `settings.ts`:

  ```ts
  export const BOARD_SETTING_DEFAULTS = { anonymous: false, autoSort: true, hideCards: false } as const;
  export type BoardSettings = { [K in keyof typeof BOARD_SETTING_DEFAULTS]: boolean };
  export function readBoardSettings(meta): BoardSettings;          // non-default iff stored === !default
  export function setBoardSetting(meta, key, value): void;         // stores only non-default values
  ```

  - **No migration needed:** "store only non-default values" matches today's encoding exactly. `anonymous` is stored only when true and `autoSort` only when false.
  - **Callers:**
    - Connection state exposes `settings`.
    - `BoardFile.board`, the archive request and `seedBoard` copy the settings.
    - `LeadControls.svelte` renders its toggles from one descriptor list (`{ key, label, onTitle, offTitle }`) in both layouts instead of duplicating buttons.
  - **Result:** the next boolean setting is a one-line default plus one descriptor.

#### 7. Leave room for clusters ("topics") without building them

With the card codec (§2) and the settings registry (§6) in place, clusters later need:

- an optional `groupId` field in the codec and `CardData`
- a new top-level `groups` Y.Map (`id → { label }`)
- a "Cluster" action in the Group phase

None of PRs 1–5 should add a card field or rely on a fixed card shape outside the codec. That's the only constraint on them now.

### Product decisions

| \# | Question | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Max columns | **Decided: no product limit.** Hosts add as many as they want. | Scott's call: managing a wide board is the user's problem. The ≥5-column horizontal-scroll layout already handles any width. A hidden safety ceiling of 50 (`MAX_INPUT_COLUMNS`) stays in `sanitizeColumns` and the archive check, because `meta.columns` is untrusted and a client writing 100k columns would freeze everyone's tab. |
| D2 | Can a custom board drop Action items? | **Decided: no, always included.** | It's empty until the Actions phase, so it costs a brainstorm board nothing. Dropping it means the phase list depends on the columns, which is a bigger change. The `isActionsColumn` helper keeps that possible later. |
| D3 | Edit columns after creation? | **No in v1** (rename/add later) | The data model already supports rename, thanks to stable keys and an atomic list. The UI and the "what happens to cards in a deleted column" question are the real cost. |
| D4 | Does hide-cards hide from the host too? | **Yes, with no peek** | The point is to avoid anchoring, and hosts often write cards too. Matches Spreo. EasyRetro's peek can come later. |
| D5 | Hide cards again if the lead goes back to Brainstorm? | **Yes** (visibility depends only on phase) | No reveal state to store or sync. Going back is usually done to add late ideas privately. |
| D6 | Does "Start next retro" keep custom columns? | **Yes** | A team running Start/Stop/Continue wants the same layout next time. A one-off brainstorm host can just start a fresh board instead. |
| D7 | Host-dashboard boards aren't anonymous by default (finding 3) | **Keep current behavior in the refactor; ask Scott whether to align** | A refactor shouldn't change behavior quietly. |
| D8 | Column title max length | **100 characters, wrapping** | Problem statements are longer than retro headings. |
| D9 | Ship extra presets (Start/Stop/Continue, Mad/Sad/Glad, 4Ls)? | **Not in this rollout** | `BOARD_TEMPLATES` makes each one a single data entry. Add them when someone asks. |

### PR plan

Base branch is `main` in this repo (not `master`). Use the branch prefixes from `CONTRIBUTING.md`. Every PR must pass `cargo test`, `cargo clippy --all-targets`, `bun run check`, `bun run test:unit` and `./test-local.sh`. Open each PR and send Scott the link; don't merge without review.

| \# | Branch | Kind | User-visible change | Size |
| --- | --- | --- | --- | --- |
| 0 | `docs/custom-columns-plan` | docs | none | S |
| 1 | `refactor/column-model` | refactor | none | M |
| 2 | `refactor/board-seed` | refactor | none | M |
| 3 | `feat/custom-columns-storage` | feat | Custom-column boards render, export, import and archive. The only way to create one is importing a v2 file. | M–L |
| 4 | `feat/custom-columns-create` | feat | **Start a new retro → Columns: Retro / Custom** | S–M |
| 5 | `feat/hide-cards` | feat | **Hide others' cards while brainstorming** | M |
| — | later | feat | Clusters, only if asked again | — |

PRs 1 and 2 don't depend on each other. PR 3 needs both, PR 4 needs PR 3, and PR 5 needs PR 2 (for seeding `hideCards`) and the column helpers from PR 1, but not PRs 3–4. PR 5 could go in parallel with PRs 3–4 if speed matters.

**PR 0: plan.** This document.

**PR 1: column model (no behavior change).**

- Commits:
  1. Add `columns.ts` (`ColumnDef`, `DEFAULT_COLUMNS`, `sanitizeColumns`, `readColumns`, `COLUMN_STYLE`, `isActionsColumn`) plus `columns.spec.ts` covering the cleanup rules.
  2. Add the card codec and use it in `readCards`, `moveCard`, `mergeCards`, `importBoard` and `rehydrateCard`.
  3. Replace every frontend hard-coded list from finding 1 with `state.columns`/`DEFAULT_COLUMNS`. Change `cards` to `Record<string, CardData[]>`, add `countCards`, and change `canAddCardInColumn` to take a `ColumnDef`.
  4. Extract `BoardColumn.svelte`.
- `readColumns` is wired in, but nothing writes `meta.columns` yet, so every board resolves to `DEFAULT_COLUMNS`.
- **Done when:** the full e2e suite passes **with no test assertion changes**. If a test assertion had to change, the change isn't a pure refactor. Running `grep -rn "wentWell\|toImprove" frontend/src` finds those keys only in `columns.ts`, fixtures and tests.

**PR 2: one board seed (no behavior change).**

- **Changes:**
  - `setPendingSeed`/`consumePendingSeed`, the `new` origin, `importBoard` → `seedBoard`, and `newBoardSeed()`.
  - The seed is applied in the `createBoard` sync transaction through `takeSeed`.
  - Remove the three `pending*` effects and the old pending APIs.
  - Move the three callers over: the home page sets anonymous true, the host dashboard keeps anonymous false (D7), and next retro uses carry-over.
- **Done when:** these existing specs pass unchanged:
  - `import.spec.ts`, `board-file-ux.spec.ts`, `anonymous.spec.ts`
  - `retro-session.spec.ts`, `host-dashboard.spec.ts` and `end-celebration.spec.ts` (carry-over is covered in `board-file-ux.spec.ts` and `import.spec.ts`)
- **New unit tests:** applying a seed to a fresh doc creates label, settings and arrays in one transaction, and applying it to a non-empty board is a no-op.

**PR 3: custom columns, end to end except creation.**

- **Changes:**
  - Board file v2 plus a frozen v2 fixture.
  - `seedBoard` writes `meta.columns` and the arrays in one transaction.
  - `archive.rs` map plus columns and validation; `sync.rs` generic count.
  - CSV with columns; archive viewer; N-column layout.
  - Carry-over inherits columns (D6).
- **New e2e** `tests/custom-columns.spec.ts`:
  - Import a v2 file with 5 problem-statement columns.
  - A second participant sees the same 5 columns plus Action items and can add cards to every input column in Brainstorm.
  - Cards persist after a reload.
  - Merging across columns still works.
  - Export JSON → import gives the same columns and order.
  - CSV uses custom titles.
  - End → the archive viewer shows the custom columns.
  - Start next retro keeps the columns.
- **Regression:** a v1 file still imports as three columns (the existing fixture test).
- **Rust tests:** as listed in §4.

**PR 4: creation UI.**

- **Modal:** `NewRetroModal.svelte` gets a "Columns" segmented control (**Retro** | **Custom**). Custom shows one title input to start, an **+ Add column** button with no visible limit, remove buttons, plus a locked "Action items (always included)" row. The control is hidden when importing a file, because the file brings its own columns.
- **Return value:** the modal returns a seed (`newBoardSeed(...)`) instead of `{ slug, label, importFile }`, so both pages stop building handoffs themselves.
- **Docs:** update `/docs` (the Brainstorm line names the two legacy columns) and the README Features list.
- **Analytics:** add `{ name: 'board_create'; params: { template: 'retro' | 'custom'; columns: number } }` so we can tell whether anyone uses this. That data feeds the "revisit clusters" call.
- **E2e:** create a custom board from the home page and from the host dashboard. Validation: empty titles are skipped, a 10-column board scrolls sideways, and long titles wrap.

**PR 5: hide cards.**

- **Commits:**
  1. Settings registry and the `LeadControls` descriptor refactor (no behavior change; existing anonymous and auto-sort specs must pass).
  2. `visibility.ts` with `visibility.spec.ts` covering every row of the rules in §6.
  3. `HiddenCard.svelte`, the toggle in the New retro modal (seeded) and in `LeadControls`, the banner, and `hideCards` in the board file and archive request.
- **E2e** `tests/hide-cards.spec.ts`, with two browser contexts:
  - In Brainstorm, B sees A's card as a placeholder, and B's DOM doesn't contain A's text.
  - A sees their own card.
  - Action items carried over from a previous retro stay visible.
  - Moving to Group reveals A's card to B with no reload.
  - Going back to Brainstorm hides it again.
  - An ended board in Brainstorm shows everything.
  - Toggling off reveals immediately.

### Deploy and rollout

- **Deploy procedure (from the workspace `AGENTS.md`):** back up `data/fastretro.db`, keep the old binary as `fast-retro.prev`, swap in the new release build, restart `fast-retro-prod`. Never run e2e against prod.
- **Checkpoint 1, after PRs 1–2:** deploy the refactors alone so any regression is clearly theirs. On prod, smoke-test:
  - create a board from the home page and from the host dashboard
  - import a `.fastretro.json` file
  - end a retro, then Start next retro with carried actions
  - check the archive viewer and host dashboard card counts
- **Checkpoint 2, after PRs 3–4:** custom columns go live. Smoke-test a 5-column board end to end, including end → archive → export → import. Then tell the user who asked for it; the product loop matters as much as the code.
- **Checkpoint 3, after PR 5:** hidden cards. Run a quick two-browser check on prod.
- **Rollback safety:**
  - The old binary rejects v2 board files, as intended, and ignores the unknown `columns` field in archives.
  - An old frontend shows only the three legacy keys, so custom-column cards become **invisible but aren't deleted** (they stay in the Yjs doc and archive JSON).
  - **The one real hazard:** ending a custom board while running the *old* binary would write an archive with those cards missing. If a rollback is needed after checkpoint 2, roll forward instead if at all possible.
- **Flags:** none needed. The features are opt-in when creating a board, and existing boards can't reach the new code paths.

### Risks and how the plan handles them

| Risk | Mitigation |
| --- | --- |
| Concurrent array creation loses cards (finding 7) | Columns and arrays are written in one seed transaction, nothing creates arrays lazily, and the ensure loop runs after the seed. |
| A malicious or buggy client writes junk to `meta.columns` | `sanitizeColumns` on every read; the server validates archive requests. |
| Refactors break existing flows quietly | Refactor PRs may not change any test assertion, and they're deployed alone at checkpoint 1. |
| Layout regression on classic boards | Three columns must render the same as today; compare a screenshot of a classic board before and after in PR 1. |
| Seven stacked columns on mobile | Acceptable for v1. If it matters, collapse the empty Action items column during Brainstorm on small screens as a follow-up. |
| People treat hide-cards as security | Tooltip wording, docs wording, and placeholders that keep the text out of the DOM. |

### Notes for the implementing agent

- **Read first:** `README.md`, `CONTRIBUTING.md`, `tests/README.md`, `docs/export-ended-retro-plan.md` (house style for plans), then `yboard.ts`, `boardfile.ts`, `useBoardConnection.svelte.ts`, `Board.svelte` and `archive.rs`.
- **Stacked PRs:** each PR is based on the one before it. Run the full test list before opening each one, and send Scott the link.
- **Database safety:** never delete, truncate or "fresh start" any `.db` file (workspace rule). E2e tests use `./test-local.sh`, which uses a temporary database.
- **Comments:** only where the *why* isn't obvious (`CONTRIBUTING.md`). The race and versioning invariants above deserve comments; the rest doesn't.