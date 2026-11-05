import { test, expect, type Page } from '@playwright/test';

/**
 * Merging in the Group phase: dragging one card onto another groups them, and
 * the lead can then merge the group into one card. The target card keeps its id,
 * its text grows to include the other card's text after a `— — —` separator,
 * votes are unioned, and the other card disappears.
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

test.describe('fast-retro group-phase merge', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('lead groups two cards by dragging, then merges the group', async ({ browser }) => {
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

      // Drag cardB onto cardA. They group and both stay.
      const source = column.getByRole('group', { name: `Card: ${cardB}` });
      const target = column.getByRole('group', { name: `Card: ${cardA}` });
      await source.dragTo(target);
      await expect(column.getByRole('list', { name: /^Group: Untitled group, 2 cards/ })).toBeVisible({ timeout: 10_000 });
      await expect(column.getByRole('group', { name: /^Card: / })).toHaveCount(2);

      // Merge asks first, and Cancel changes nothing.
      await leadPage.getByRole('button', { name: 'Merge Untitled group' }).click();
      const confirm = leadPage.getByRole('alertdialog', { name: 'Confirm merge' });
      await expect(confirm).toContainText('2 cards become one card in What went well');
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(column.getByRole('group', { name: /^Card: / })).toHaveCount(2);

      await leadPage.getByRole('button', { name: 'Merge Untitled group' }).click();
      await confirm.getByRole('button', { name: 'Merge cards' }).click();

      // Target should now contain both texts joined by the `— — —` separator.
      const merged = column.getByRole('group', { name: /^Card: / }).filter({ hasText: cardA });
      await expect(merged).toContainText(cardA, { timeout: 10_000 });
      await expect(merged).toContainText(cardB, { timeout: 10_000 });
      await expect(merged).toContainText('— — —');

      // Source card should be gone — only one card left in the column.
      await expect(column.getByRole('group', { name: /^Card: / })).toHaveCount(1, { timeout: 10_000 });
      // The survivor is an ordinary card again.
      await expect(leadPage.getByTestId('group-block')).toHaveCount(0);
    } finally {
      await leadCtx.close();
    }
  });
});
