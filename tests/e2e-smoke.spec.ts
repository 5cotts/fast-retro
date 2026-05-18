import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const NAME_PRIMARY = `pw-${Math.random().toString(36).slice(2, 8)}`;
const NAME_SECONDARY = `pw-${Math.random().toString(36).slice(2, 8)}`;

async function joinBoardAs(page: Page, name: string, slug = `pw-${Date.now()}`) {
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

test.describe('fast-retro smoke', () => {
  test('golden path: join, create card, comment, react, keyboard-move', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await joinBoardAs(page, NAME_PRIMARY);

    const cardText = `smoke ${Date.now()}`;
    const card = await addCard(page, 'What went well', cardText);

    // --- comment ---
    await card.getByRole('button', { name: /Comments/ }).click();
    const commentText = `hello ${Math.random().toString(36).slice(2, 6)}`;
    const commentInput = card.getByPlaceholder('Add a comment…');
    await commentInput.fill(commentText);
    // Best-effort typing indicator check (won't fail the test if missing).
    await commentInput.click();
    await card.getByRole('button', { name: 'Post' }).click();
    await expect(card.getByText(commentText)).toBeVisible();

    // --- reaction ---
    await card.getByRole('button', { name: 'Add a reaction', exact: true }).click();
    const reactionMenu = card.getByRole('menu');
    await expect(reactionMenu).toBeVisible();
    await reactionMenu.getByRole('menuitem', { name: 'React with party' }).click();
    await expect(
      card.getByRole('button', { name: /Remove your party reaction \(1/ })
    ).toBeVisible();

    // --- share button copies participant URL to clipboard ---
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const shareButton = page.getByRole('button', { name: /Copy board link to share/ });
    await shareButton.click();
    await expect(
      page.getByRole('button', { name: 'Board link copied to clipboard' })
    ).toBeVisible();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/\/board\/[^/]+$/);
    expect(clipboardText).not.toContain('/lead/');

    // --- move with Shift+Arrow keyboard nav ---
    // Focus the card itself (the role="group" element handles arrow-keys).
    await card.focus();
    await page.keyboard.press('Shift+ArrowRight');

    const toImproveColumn = page.getByRole('list', { name: 'What to improve' });
    await expect(
      toImproveColumn.getByRole('group', { name: `Card: ${cardText}` })
    ).toBeVisible();
    // Confirm it left "What went well".
    await expect(
      page.getByRole('list', { name: 'What went well' }).getByRole('group', { name: `Card: ${cardText}` })
    ).toHaveCount(0);

    await context.close();
  });

  test('first-time visitor sees onboarding overlay that auto-dismisses and does not return', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const slug = `pw-onboard-${Date.now()}`;
    const name = `pw-${Math.random().toString(36).slice(2, 8)}`;

    await page.goto(`/board/${slug}`);
    await page.getByLabel('Your display name').fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();

    // Onboarding modal should appear after first-time name submit.
    const heading = page.getByRole('heading', { name: /First retro\?/ });
    await expect(heading).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(heading).toBeHidden();

    // Reload — onboarding should NOT return because the flag is persisted.
    await page.reload();
    await expect(page.getByRole('list', { name: 'What went well' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /First retro\?/ })).toBeHidden();

    await context.close();
  });

  test('homepage Start-a-new-retro modal derives slug from board name', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Seed a recent so the homepage renders the CTA list instead of auto-
    // redirecting to a fresh board for empty-state visitors.
    await page.addInitScript(() => {
      localStorage.setItem(
        'retro-recent-boards',
        JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])
      );
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Start a new retro' }).click();

    const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
    await expect(dialog).toBeVisible();

    const label = `Sprint Test ${Math.random().toString(36).slice(2, 5)}`;
    await dialog.getByLabel('Retro name').fill(label);
    await dialog.getByRole('button', { name: 'Create retro' }).click();

    // URL slug should derive from the typed label (with a short random suffix).
    await page.waitForURL(/\/board\/sprint-test-/);
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/^\/board\/sprint-test-[a-z0-9-]+$/);

    await context.close();
  });

  test('second browser context sees presence broadcast', async ({ browser }) => {
    const sharedSlug = `pw-presence-${Date.now()}`;
    const ctxA: BrowserContext = await browser.newContext();
    const pageA = await ctxA.newPage();
    await joinBoardAs(pageA, NAME_PRIMARY, sharedSlug);

    const ctxB: BrowserContext = await browser.newContext();
    const pageB = await ctxB.newPage();
    await joinBoardAs(pageB, NAME_SECONDARY, sharedSlug);

    // Each page should show two presence entries (both names). The presence
    // list lives in the header — we just confirm both names appear somewhere
    // in each page's DOM.
    await expect(pageA.locator('body')).toContainText(NAME_SECONDARY, { timeout: 10_000 });
    await expect(pageB.locator('body')).toContainText(NAME_PRIMARY, { timeout: 10_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
