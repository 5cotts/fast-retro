import { test, expect, type Page } from '@playwright/test';

/**
 * Group-phase drag-to-merge: in the Group phase, the lead can drag one
 * card onto another in the same column to merge them. The target card
 * keeps its id, its text grows to include the source card's text after
 * a `— — —` separator, votes are unioned, and the source card disappears.
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

test.describe('fast-retro group-phase drag-to-merge', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('lead drags one card onto another to merge them', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-merge-${Date.now()}`;
    const leadName = `lead-${Math.random().toString(36).slice(2, 6)}`;
    const cardA = `Pairing sessions worked ${Date.now()}`;
    const cardB = `Loved the pairing time ${Date.now()}`;

    const leadCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();

    try {
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, leadName);

      // Add two related cards in the same column.
      const draft = leadPage.getByLabel('Add a card to What went well');
      const column = leadPage.getByRole('list', { name: 'What went well' });
      await draft.fill(cardA);
      await column.getByRole('button', { name: 'Add card', exact: true }).click();
      await expect(column.getByRole('group', { name: `Card: ${cardA}` })).toBeVisible();

      await draft.fill(cardB);
      await column.getByRole('button', { name: 'Add card', exact: true }).click();
      await expect(column.getByRole('group', { name: `Card: ${cardB}` })).toBeVisible();

      // Advance Brainstorm → Group.
      await leadPage.getByRole('button', { name: 'Advance to Group phase' }).click();
      await expect(
        leadPage.locator('[role="listitem"][aria-current="step"]').filter({ hasText: 'Group' })
      ).toBeVisible({ timeout: 10_000 });

      // Drag cardB onto cardA. dragTo dispatches a synthetic HTML5
      // drag sequence which the Card component listens for in mergeMode.
      const source = column.getByRole('group', { name: `Card: ${cardB}` });
      const target = column.getByRole('group', { name: `Card: ${cardA}` });
      await source.dragTo(target);

      // Target should now contain both texts joined by the `— — —` separator.
      const merged = column.getByRole('group').filter({ hasText: cardA });
      await expect(merged).toContainText(cardA, { timeout: 10_000 });
      await expect(merged).toContainText(cardB, { timeout: 10_000 });
      await expect(merged).toContainText('— — —');

      // Source card should be gone — only one card left in the column.
      await expect(column.getByRole('group')).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await leadCtx.close();
    }
  });
});
