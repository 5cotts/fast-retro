import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

/**
 * Regression test for CSV formula injection (frontend/src/lib/csv.ts).
 * Card text and comments are unauthenticated free-text from any participant;
 * a cell starting with =+-@ would execute as a formula if a host opened the
 * exported CSV in Excel/Sheets. Confirms the real export path (button click
 * → downloaded file) neutralizes it, not just the `csvCell` function in
 * isolation (covered separately by frontend/src/lib/csv.spec.ts).
 */

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

test.describe('fast-retro CSV export', () => {
  test('neutralizes formula-injection card text in the downloaded CSV', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Seed a recent board so the homepage renders the CTA instead of
    // auto-redirecting an empty-state visitor straight to a fresh board.
    await page.addInitScript(() => {
      localStorage.setItem(
        'retro-recent-boards',
        JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])
      );
    });

    // Create via the homepage flow so this browser gets the host key
    // (Download CSV only renders for the host — see LeadControls.svelte).
    await page.goto('/');
    await page.getByRole('button', { name: 'Start a new retro' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
    await expect(dialog).toBeVisible();
    const label = `CSV Export Test ${Math.random().toString(36).slice(2, 6)}`;
    await dialog.getByLabel('Retro name').fill(label);
    await dialog.getByRole('button', { name: 'Create retro' }).click();
    await page.waitForURL(/\/board\/csv-export-test-/);

    await page.getByLabel('Your display name').fill(`pw-${Math.random().toString(36).slice(2, 8)}`);
    await page.getByRole('button', { name: 'Join the retro' }).click();
    await dismissOnboardingIfPresent(page);

    const cardText = `=cmd|'/c calc'!A1 ${Date.now()}`;
    const draft = page.getByLabel('Add a card to What went well');
    await draft.click();
    await draft.fill(cardText);
    const wentWell = page.getByRole('list', { name: 'What went well' });
    await wentWell.getByRole('button', { name: 'Add card', exact: true }).click();
    await expect(wentWell.getByRole('group', { name: `Card: ${cardText}` })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download CSV/ }).click()
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const csv = readFileSync(path as string, 'utf-8');

    const dataRow = csv.split('\n').find((line) => line.includes(String(cardText).split(' ')[1]));
    expect(dataRow, `expected a data row for the card in:\n${csv}`).toBeTruthy();
    // Neutralized with a leading quote, and since the cell also contains a
    // comma (from the shell pipe args) it's additionally CSV-quoted.
    expect(dataRow).toContain("'=cmd");
    // The raw formula must never appear unescaped/unprefixed.
    expect(csv).not.toMatch(/,=cmd\|/);

    await context.close();
  });
});
