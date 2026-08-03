import { test, expect, type Page } from '@playwright/test';

async function joinBoardAs(page: Page, name: string, slug: string) {
  await page.goto(`/board/${slug}`);
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole('button', { name: 'Join the retro' }).click();
  // First-time visitors get a dismissible onboarding overlay covering the
  // board — dismiss it so the rest of the test can interact with the page.
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }
  await expect(page.getByRole('list', { name: 'What went well' })).toBeVisible();
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

test.describe('fast-retro reload persistence', () => {
  test('cards survive repeated reloads by a returning user', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const slug = `pw-reload-${Date.now()}`;
    const name = `pw-${Math.random().toString(36).slice(2, 8)}`;

    await joinBoardAs(page, name, slug);

    const cardText = `reload-test ${Date.now()}`;
    await addCard(page, 'What went well', cardText);

    // Reload as a "returning user" — Board.svelte's onMount fast path,
    // since the display name is already in localStorage after joinBoardAs.
    // Every mount spins up a brand-new local Y.Doc; if its default-column
    // init ever races ahead of the WebsocketProvider's initial sync, the
    // card is silently lost (regression: yboard.ts createBoard(), fixed by
    // deferring the init to the provider's 'sync' event). That race was
    // probabilistic (~50% loss per load empirically), so a single reload
    // isn't a reliable regression guard — loop enough times that a
    // reintroduced bug fails with overwhelming probability.
    const card = page
      .getByRole('list', { name: 'What went well' })
      .getByRole('group', { name: `Card: ${cardText}` });
    for (let i = 0; i < 8; i++) {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 15_000 });
    }

    await context.close();
  });
});
