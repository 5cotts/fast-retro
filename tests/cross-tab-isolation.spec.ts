import { test, expect, type Page } from '@playwright/test';

async function joinBoardAs(page: Page, name: string, slug: string) {
  await page.goto(`/board/${slug}`);
  // Both pages share localStorage within a BrowserContext, so if page A
  // already joined with this name, page B auto-joins via the returning-user
  // fast path and skips the name prompt entirely — race the two outcomes
  // instead of a point-in-time isVisible() check, which is flaky against
  // whichever branch hasn't rendered yet.
  const nameInput = page.getByLabel('Your display name');
  const board = page.getByRole('list', { name: 'What went well' });
  await expect(nameInput.or(board).first()).toBeVisible();
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }
  await expect(board).toBeVisible();
}

async function addCard(page: Page, columnTitle: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${columnTitle}`);
  await draft.click();
  await draft.fill(text);
  const column = page.getByRole('list', { name: columnTitle });
  await column.getByRole('button', { name: 'Add card', exact: true }).click();
  const card = column.getByRole('group', { name: `Card: ${text}` });
  await expect(card).toBeVisible();
  return card;
}

test.describe('fast-retro cross-tab isolation', () => {
  test('two unrelated boards open in the same browser do not sync with each other', async ({
    browser
  }) => {
    // Same BrowserContext (== same browser profile) for both pages — this is
    // the condition that matters. Two separate contexts (as in the presence
    // test in e2e-smoke.spec.ts) would NOT reproduce this bug, because
    // BroadcastChannel is scoped per browser profile, not per Playwright
    // context in general — it only leaks across pages/tabs that share one.
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const slugA = `pw-isolation-a-${Date.now()}`;
    const slugB = `pw-isolation-b-${Date.now()}`;
    const name = `pw-${Math.random().toString(36).slice(2, 8)}`;

    // Regression: yboard.ts's createBoard() passed the literal string 'ws' as
    // WebsocketProvider's `roomname`, which y-websocket uses (independent of
    // the `?board=<slug>` query param actually used for server-side routing)
    // to name its cross-tab BroadcastChannel — `serverUrl + '/' + roomname`.
    // Every board on this origin got the same channel, so two tabs open on
    // *different* boards synced their Yjs docs directly with each other,
    // bypassing the server's per-slug room separation. Fixed by disabling
    // that same-origin BroadcastChannel shortcut (disableBc: true) since the
    // server round-trip already provides real-time sync.
    await joinBoardAs(pageA, name, slugA);
    await joinBoardAs(pageB, name, slugB);

    const cardText = `isolation-test ${Date.now()}`;
    await addCard(pageA, 'What went well', cardText);

    // Give any (buggy) BroadcastChannel sync a real chance to fire — it's
    // synchronous/near-instant when it happens, but leave headroom.
    await pageB.waitForTimeout(2000);

    await expect(
      pageB.getByRole('group', { name: `Card: ${cardText}` })
    ).toHaveCount(0);
    // The board label is a simpler, single-key signal for the same leak —
    // board B's title should stay its own slug, never inherit board A's.
    await expect(pageB).toHaveTitle(/^Fast Retro$/);

    await context.close();
  });
});
