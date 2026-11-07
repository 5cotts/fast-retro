# fast-retro e2e tests

End-to-end smoke tests for fast-retro, run with Playwright (Chromium).

## Run

Tests only run against a **locally-running instance** — never a public
deployment. Hitting a public deployment through a proxy/CDN from a sandboxed
browser adds enough latency to make even basic UI interactions flaky.

**⚠️ Use a disposable instance, port, and database, never the app's default
port/DB.** The app's default `PORT` (5102, from `.env.example`) and default
`FASTRETRO_DB` (`data/fastretro.db`) are what the production service on this box
uses, and it runs from this checkout's directory. Running the commands below
without the isolation flags can collide with its port and write test data into
its real database.

Prod's binary now lives in `fast-retro-releases/builds/`, so building
`target/release/fast-retro` no longer replaces it. See
[`docs/RELEASING.md`](../docs/RELEASING.md).

### One command (recommended)

```bash
bun install            # installs @playwright/test, first time only
bunx playwright install chromium   # one-time browser download
./test-local.sh
```

`test-local.sh` starts a `cargo run` backend on a scratch port (`5199` by
default, override with `TEST_PORT`) and a temp-file database, waits for it
to come up, runs the full suite against it, then kills the backend and
deletes the scratch database on exit (success, failure, or Ctrl-C) — no
env vars to remember, and no way to end up pointed at `target/release/fast-retro`
or the app's default port/DB by omission.

To run the suite against a prebuilt binary instead of `cargo run` (this is
what CI does with the release binary it ships):

```bash
FASTRETRO_BIN=path/to/fast-retro ./test-local.sh
```

The binary embeds the frontend at compile time, so build it after the
frontend (`bun run build`), or the suite tests a stale bundle. The script
refuses ports 5102 and 5103 (prod and QA).

### CI

`.github/workflows/build.yml` has two tiers:

- **Quick** (every PR push): frontend build, `bun run check`,
  `bun run test:unit`, `cargo test`, clippy (warning count reported, not
  gated). No e2e.
- **Full** (pushes to `main`, manual runs, and PRs with the `e2e` label):
  the quick checks, then `cargo build --release` and this e2e suite against
  that release binary (`FASTRETRO_BIN`). It uploads the binary, `index.html`
  and a `BUILD_INFO` file as the artifact `fast-retro-<sha>` (kept 90 days),
  and a second job attests the binary's provenance. On failure, the
  Playwright report is uploaded as `e2e-report-<sha>`.

To run e2e on a PR, add the label: `gh pr edit <n> --add-label e2e`. While
the label stays on, every push to that PR runs the full tier. The release
scripts deploy only attested CI builds, so QA'ing a PR needs the label; see
`docs/release-plan.md` §2.10.

`cargo fmt --check` is not a gate yet (`main` isn't formatted).

### Manual (for iterating on a test — keeps the server up between runs)

From the project root, start a **disposable** local instance — `cargo run`
(not `./build.sh` / `target/release/fast-retro`), a non-default port, and a
scratch DB file that isn't checked in (`data/` is gitignored):

```bash
RETRO_LEAD_TOKEN=dev-token PORT=5199 FASTRETRO_DB=data/fastretro-e2e-test.db COOKIE_SECURE=false FASTRETRO_RATE_LIMIT=10000 cargo run
```

Then, in another terminal:

```bash
RETRO_LEAD_TOKEN=dev-token bun run test:e2e
```

Tests default to `http://localhost:5199` (see `playwright.config.ts`) — a
dedicated test port, not the app's default. `E2E_BASE_URL` only exists to
point at a different *local* port — e.g. the two-terminal dev loop's Vite
server:

```bash
E2E_BASE_URL=http://localhost:5173 bun run test:e2e
```

## What they cover

`e2e-smoke.spec.ts` — single-user smoke:

1. **Golden path** — join the board with a fresh name, create a card in
   the "Went Well" column, add a comment, react with 🎉, then move the
   card to "To Improve" using `Shift+ArrowRight`.
2. **Presence** — opens a second browser context with a different name
   and confirms each page sees the other user's name in the DOM.
3. **Share button** — clicks the header "Share" button and confirms it
   copies the participant-facing board URL to the clipboard (and that
   the URL never contains the `/lead/<token>` prefix).
4. **Onboarding overlay** — confirms a first-time visitor sees the "First
   retro?" tips modal after submitting their name, that "Got it"
   dismisses it, and that a reload does not bring it back.

`retro-session.spec.ts` — full multi-user session (skipped unless
`RETRO_LEAD_TOKEN` is set):

5. **Lead + two engineers walk all five phases** — one lead and two
   engineers (Alice, Bob) join the same fresh board. Engineers add
   cards in Brainstorm; the lead starts a timer (engineers see the
   pill); the lead advances Brainstorm → Group → Vote; both engineers
   upvote Alice's card and all three pages converge on the right
   count (`Remove vote (2)` for voters, `Upvote (2)` for the lead);
   the lead advances to Discuss; Alice reacts with 🎉, Bob comments
   and the lead's view sees `Comments (1)`; the lead advances to
   Actions; Alice records an action item; the lead opens the "End
   retro" confirm dialog and cancels (so we don't wipe state mid-test).

Each run uses random names and a random slug so it doesn't collide
with itself.

`anonymous.spec.ts` — anonymous mode (skipped unless
`RETRO_LEAD_TOKEN` is set): one lead, one participant. The lead
drops a card; the participant sees the lead's name on the byline.
The lead toggles "Anonymous" on; both pages surface the Anonymous
badge; the lead still sees their own card as "you (hidden)" while
the participant sees "Anonymous" with no name. Toggle off and the
name returns.

`custom-emoji.spec.ts` — custom emoji reactions (skipped unless
`RETRO_LEAD_TOKEN` is set): one lead, one participant. The lead
opens the reaction picker on their own card, searches for "rocket"
(not among the default quick-reaction emojis), reacts with 🚀, and
confirms the participant sees the same reaction. Then switches to
the Hearts category tab and reacts with 🧡 to verify category
browsing also works end-to-end.

`reload-persistence.spec.ts` — regression test for a CRDT init race
(fixed in `yboard.ts`'s `createBoard()`): a returning user (name
already in localStorage) joins, adds a card, then reloads 8 times in
a row, asserting the card stays visible after every reload. The bug
this guards against set default empty Y.Arrays for the board columns
*before* the WebsocketProvider's initial sync completed, which could
race the server's real column data and — empirically, about half the
time per load — silently wipe existing cards once the empty state
synced back and persisted. A single reload only catches that
regression half the time, hence the loop.

`cross-tab-isolation.spec.ts` — regression test for a shared
cross-tab BroadcastChannel (fixed in `yboard.ts`'s `createBoard()`
via `disableBc: true`): two pages in the *same* browser context join
two *different* boards; a card added on board A must not appear on
board B. y-websocket keys its same-origin BroadcastChannel sync by
`serverUrl + '/' + roomname`, and this app hardcodes `roomname` to
`'ws'` for every board (the real per-board routing goes through the
`?board=<slug>` query param instead), so with BC enabled *any* two
boards open at once in one browser synced their Yjs docs directly
with each other — label, phase, presence every time, and card data
non-deterministically (same Y.Map last-write-wins race as the reload
bug above) — regardless of which slugs they pointed at. Two separate
Playwright *contexts* would NOT catch this (BroadcastChannel is
scoped per browser profile); it has to be two pages in one context.

`end-celebration.spec.ts` — ending a retro shows the confetti, message and "ended"
banner live on every connected client, including when the host's socket is slow (the
server announces the end itself, regression test for a race that left participants on
a board that looked live). A failed end tells nobody and the retro carries on.

`json-export.spec.ts` — Export → Save board file (skipped unless
`RETRO_LEAD_TOKEN` is set): checks the `.fastretro.json` contents, that
anonymous boards leave names out, the End retro "Save board file & end"
path, and the archive viewer's export.

`import.spec.ts` — Import from file… on the homepage:

- **Round trip** (needs `RETRO_LEAD_TOKEN`): a two-user board is
  exported and imported in a fresh browser; cards, order, votes,
  reactions, comments, names, phase and settings match, before and
  after a reload. An original participant opening the imported board
  still owns their cards and votes. Also covers an anonymous board
  (no names) and a file downloaded from the archive viewer.
- **Bad files** (always run): a truncated export, an old CSV export,
  JSON that isn't an export, a newer version and a file over 1 MB are
  each rejected in the preview with a readable message, the submit
  button stays disabled (Enter included) and no board is created. A
  partly broken file imports its good cards with warnings, and the
  modal recovers after an error (Remove, or picking a good file).
  Each rejection also checks the `board_import` analytics event and its
  reason code. Every test fails on an uncaught page error.

`board-file-ux.spec.ts` — always runs (boards are created from the
homepage, so no lead token): the Export menu by keyboard and mouse
(arrow keys, Escape, click outside, both downloads), dropping a board
file anywhere on the homepage, the "Imported from a file" note, and
Start next retro bringing action items along (without votes or
reactions) by default. Analytics are checked with a stubbed `gtag`.

`ended-export.spec.ts` — exporting a retro after it has ended (skipped
unless `RETRO_LEAD_TOKEN` is set). The host after a reload, a participant
who was there when it ended, and a brand-new visitor all get the Export
menu in the ended banner, and their files match a live export. The new
visitor gets no name prompt. Also covers the CSV, the `ended` analytics
source, importing the ended export, anonymous boards (no names), and the
menu staying disabled until the board has synced.

`custom-columns.spec.ts` — boards with custom columns. A five-column
board file imports from the homepage; a second participant sees the same
columns and adds a card to each one during Brainstorm; cards survive a
reload; the wide board scrolls sideways; merging works across columns;
the JSON export (v2) and CSV keep the columns and re-import the same; the
archive keeps them (archive viewer checked when `RETRO_LEAD_TOKEN` is
set); Start next retro keeps them. A second test checks that a classic
board still has the three retro columns and exports as v1. Another
creates a custom board with the Action items column unticked: the phase
bar ends at Discuss, the export has no `actions` column and re-imports
that way, ending offers no action items to bring, and Start next retro
keeps the columns.

`brainstorm-scenario.spec.ts` — the problem-solving brainstorm that
prompted custom columns, end to end with a host and two participants (no
lead token): problem-statement columns, no Action items, hidden cards;
the host adds a forgotten fifth problem from Edit board after people have
joined; a 10-minute timer everyone sees; private ideas shown to others only
as placeholders; Group reveals them; the host groups, then merges, a duplicate; voting;
Discuss is the last phase, sorts by votes and takes comments; ending and
exporting keep the columns. `docs/qa-brainstorm-scenario.md` is the same
scenario as a manual script.

`hide-cards.spec.ts` — Hide others' cards while brainstorming (two
browsers, no lead token). Set in Start a new retro; others' cards are
placeholders with no text in the page; Group reveals them live; going back
to Brainstorm hides them again; turning the setting off reveals at once;
an ended board shows everything. A second test imports a file with the
setting on and checks that action items are never hidden.

`card-groups.spec.ts` — groups of cards across columns (two or three browsers;
skipped without `RETRO_LEAD_TOKEN`). The session that prompted it, also available
by hand as `docs/qa-card-groups.md`. Aligned rows on desktop, measured by position,
and stacked blocks on a phone. Grouping from the card menu, with each card staying
in its column and everyone seeing it live. Dragging: onto a card or a group's name
groups, a card's edges reorder, the zone shown during a drag leaves a group, and
another column's loose area changes column. Rename, leave, Ungroup and reload.
Shift+Up/Down within a section. Group names hidden when going back to Brainstorm.
Voter counts and sorted groups in Discuss. Export, CSV, re-import, ending and the
archive viewer.

`guide.spec.ts` — the user guide: every page in `lib/guide/pages.ts` loads directly and
from the sidebar, previous/next links, old `?role=` links redirect, the board's links
reach the right page, the How to use link on canvas and custom-column boards, clips
decode and can be paused, phones get a menu, no console or CSP errors, and the analytics
events fire. Changed a flow? Update its guide page and clip.

`tests/guide-clips/*.clip.ts` — the flows the guide's clips show, with their own config,
so they stay out of `./test-local.sh`. `make guide-clips` re-records them on a scratch
instance (`CLIP=<name>` for one; needs ffmpeg and a built frontend), and
`make guide-clips-check` runs the same flows without recording. Clips are compiled into
the binary and kept in git history, so re-record only the ones a change affects. CI's
quick tier enforces the size budget in `scripts/check-guide-clips.sh`.

`canvas-scenario.spec.ts` — the session that prompted canvas mode, start to finish
(host plus two people): private writing, cards from different prompts placed side by
side keeping their colors, labels, votes, Top voted, the Action items dock, ending, a
re-import that rebuilds the layout, and a next retro that's a canvas again.
`docs/qa-canvas.md` is the same session by hand.

`canvas-authoring.spec.ts` — making and running a canvas board (mostly two browsers).
The Canvas choice in Start a new retro. The composer adds under the chosen prompt, and
pans there if that's off screen. A double-click places a card; Escape or an empty draft
leaves nothing. No prompts makes a Notes prompt. A long card leaves room for the next.
The view re-fits as the canvas changes size until someone moves it. Hide-cards. Action
items are docked, not placed, through the end and into the next retro. List view has
voting, adding and no dragging, and keeps positions. A phone starts there. A host gets
prompts instead of columns, no auto-sort, and inline rename, and Discuss doesn't re-sort.
Top voted opens in Discuss, ranks cards, and can be closed.

`canvas-labels.spec.ts` — floating labels on a canvas (two browsers). Anyone adds,
drags, edits and deletes one, everyone sees it, and no card moves. A click edits rather
than moves. Hidden in Brainstorm, counted by Fit. They survive export, re-import, ending
and the archive's download (needs `RETRO_LEAD_TOKEN`), and don't carry into the next
retro. An ended board's labels can't be changed.

`canvas.spec.ts` — moving things on a canvas board, imported from a v4 file (two
browsers, `page.mouse` drives real pointer events). A drag shows live for the other person and saves on
drop. Pan and zoom stay local, a drop while zoomed out lands in the right place, and
Fit shows every card. A card dropped on a card overlaps it and never merges. A card
keeps its prompt color. A tiny movement or a press on a button doesn't drag. Shift +
arrows nudge, and tabbing to an off-screen card pans instead of scrolling. Hidden
cards are placeholders that can't be dragged. An anonymous board shows no names during
a drag. Cutting off the dragger leaves no ghost card. An ended canvas is read-only but
still pans, zooms and exports.

`canvas-persistence.spec.ts` — a canvas board's layout and card positions survive
Export, re-import, ending, the archive viewer's download (needs `RETRO_LEAD_TOKEN`)
and Start next retro, which stays a canvas but starts carried action items from the
grid. A column board writes neither field.

`edit-board.spec.ts` — Edit board (two browsers, no lead token). The host
renames, reorders and adds columns mid-Brainstorm in one save; the guest
sees the new columns live, cards stay with their column, and the guest can
add to the new one. Removing a column with cards warns with the count and
deletes them; the guest gets a "host changed the columns" notice and the
host doesn't. Options change from the dialog, Cancel changes nothing, and
the export has the edited columns. Also: turning Action items off in the
Actions phase lands the board in Discuss (and back on gives an empty
column); Save stays disabled with no named column; non-hosts and ended
boards have no Edit button; the `board_edit` analytics counts. Another
test covers inline rename: the host clicks a column title, Enter or
clicking away saves and the guest sees it live, Escape cancels, a blank
title keeps the old one, Action items can be renamed, and participants and
ended boards get a plain heading.

The frozen board files live in `frontend/src/lib/fixtures/`
(`board-v1.fastretro.json` for classic boards, `board-v2.fastretro.json`
for custom columns) and are checked by the unit tests
`boardfile-v1.spec.ts` through `boardfile-v4.spec.ts` (`bun run test:unit`).
Never edit them to make a test pass; see the README next to them.

### Lead token

The full-session test joins the lead role and therefore needs the
`RETRO_LEAD_TOKEN` for whatever instance you're testing. Either
export it before running:

```bash
RETRO_LEAD_TOKEN=… bun run test:e2e
```

or set it in your local shell profile. Without it, the test is
skipped (the smoke tests still run).

## Notes

- Tests run serially (`workers: 1`) because they share a single live
  board on the deployed service. Parallel workers would step on each
  other's state.
- `playwright.config.ts` lives at the project root. The tests directory
  is also at the project root so it can be reused by other tooling
  later if needed.
