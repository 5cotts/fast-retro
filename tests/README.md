# fast-retro e2e tests

End-to-end smoke tests for fast-retro, run with Playwright (Chromium).

## Run

Tests only run against a **locally-running instance** — never a public
deployment. Hitting a public deployment through a proxy/CDN from a sandboxed
browser adds enough latency to make even basic UI interactions flaky.

**⚠️ Use a disposable instance, port, and database — never `target/release/fast-retro`
or the app's default port/DB.** The app's default `PORT` (5102, from
`.env.example`) and default `FASTRETRO_DB` (`data/fastretro.db`) are exactly
what a production deployment uses too, if one happens to be running out of
this same checkout/`workdir` on the same host — a real possibility for any
process-supervised deployment (systemd, a container orchestrator, etc.)
pointed at this repo's default config. Building `target/release/fast-retro`
via `./build.sh` also overwrites the exact binary path such a deployment's
supervisor would restart from. Running the "obvious" commands below without
the isolation flags can kill a live deployment via port/binary collision and
write test data into its real database.

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

### Manual (for iterating on a test — keeps the server up between runs)

From the project root, start a **disposable** local instance — `cargo run`
(not `./build.sh` / `target/release/fast-retro`), a non-default port, and a
scratch DB file that isn't checked in (`data/` is gitignored):

```bash
RETRO_LEAD_TOKEN=dev-token PORT=5199 FASTRETRO_DB=data/fastretro-e2e-test.db COOKIE_SECURE=false cargo run
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
