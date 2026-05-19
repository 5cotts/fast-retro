import { test, expect, type Page } from '@playwright/test';

/**
 * End-retro → archive snapshot flow. Lead creates a board, drops one card,
 * ends the retro, and then visits /archives to verify the snapshot landed
 * server-side and that the detail page renders the card read-only.
 *
 * Skipped unless RETRO_LEAD_TOKEN is set.
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function joinAs(page: Page, path: string, name: string) {
  await page.goto(path);
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole('button', { name: 'Join the retro' }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole('list', { name: 'What went well' })).toBeVisible();
}

test.describe('fast-retro archive flow', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('end retro archives the board and shows on /archives', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-archive-${Date.now()}`;
    const cardText = `archived card ${Date.now()}`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await joinAs(page, `/lead/${LEAD_TOKEN}/${slug}`, `lead-${Date.now()}`);

      // Add a card so the archive isn't empty.
      const draft = page.getByLabel('Add a card to What went well');
      await draft.click();
      await draft.fill(cardText);
      const wentWell = page.getByRole('list', { name: 'What went well' });
      await wentWell.getByRole('button', { name: 'Add card', exact: true }).click();
      await expect(wentWell.getByRole('group', { name: `Card: ${cardText}` })).toBeVisible();

      // End retro → confirm dialog → Archive & clear.
      await page.getByRole('button', { name: 'End retro' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Archive & clear' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // Board should be cleared.
      await expect(
        wentWell.getByRole('group', { name: `Card: ${cardText}` })
      ).toBeHidden();

      // Open the archives index — the snapshot should be there.
      await page.goto(`/lead/${LEAD_TOKEN}/archives`);
      const item = page
        .getByTestId('archive-item')
        .filter({ hasText: slug })
        .first();
      await expect(item).toBeVisible({ timeout: 10_000 });

      // Drill into the archive — the card should render as a read-only snapshot.
      await item.getByRole('link').first().click();
      await expect(
        page.getByTestId('archive-card').filter({ hasText: cardText })
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('read-only snapshot')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
