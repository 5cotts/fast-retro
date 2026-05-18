# fast-retro e2e tests

End-to-end smoke tests for fast-retro, run with Playwright (Chromium).

## Run

From the project root:

```bash
bun install            # installs @playwright/test
bunx playwright install chromium   # one-time browser download
bun run test:e2e
```

By default the tests hit the live deployment at
`https://retro-board-5cotts.zocomputer.io`. To point them at a different
instance:

```bash
E2E_BASE_URL=http://localhost:5102 bun run test:e2e
```

## What they cover

`e2e-smoke.spec.ts`:

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

Each run uses random names (`pw-<rand>`) so it doesn't collide with itself.

## Notes

- Tests run serially (`workers: 1`) because they share a single live
  board on the deployed service. Parallel workers would step on each
  other's state.
- `playwright.config.ts` lives at the project root. The tests directory
  is also at the project root so it can be reused by other tooling
  later if needed.
