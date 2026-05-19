import { test, expect, type Page } from '@playwright/test';

/**
 * Custom emoji reactions: the picker exposes a searchable, category-grouped
 * catalog beyond the legacy six defaults. This test reacts with an emoji
 * that is NOT in the legacy default set (🚀) to prove arbitrary emoji can
 * be chosen, and verifies the reaction propagates to another participant.
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

test.describe('fast-retro custom emoji reactions', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('lead can react with a non-default emoji via search; participant sees it', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-emoji-${Date.now()}`;
    const leadName = `lead-${Math.random().toString(36).slice(2, 6)}`;
    const aliceName = `alice-${Math.random().toString(36).slice(2, 6)}`;
    const cardText = `ship it ${Date.now()}`;

    const leadCtx = await browser.newContext();
    const aliceCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    try {
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, leadName);
      await joinAs(alicePage, `/board/${slug}`, aliceName);

      const leadDraft = leadPage.getByLabel('Add a card to What went well');
      await leadDraft.click();
      await leadDraft.fill(cardText);
      const leadColumn = leadPage.getByRole('list', { name: 'What went well' });
      await leadColumn.getByRole('button', { name: 'Add card', exact: true }).click();

      const aliceCard = alicePage
        .getByRole('list', { name: 'What went well' })
        .getByRole('group', { name: `Card: ${cardText}` });
      await expect(aliceCard).toBeVisible({ timeout: 10_000 });

      // Open the reaction picker on the lead's own card.
      const leadCard = leadPage
        .getByRole('list', { name: 'What went well' })
        .getByRole('group', { name: `Card: ${cardText}` });
      await leadCard.getByRole('button', { name: 'Add a reaction' }).click();

      // Search box should be visible and focusable. Type "rocket" — only the
      // rocket emoji should remain in the results (it is NOT in the legacy
      // 6-emoji set).
      const search = leadPage.getByLabel('Search emoji');
      await expect(search).toBeVisible();
      await search.fill('rocket');

      const rocketBtn = leadPage.getByRole('menuitem', { name: 'React with rocket' });
      await expect(rocketBtn).toBeVisible();
      await rocketBtn.click();

      // Lead sees the rocket reaction pill with their vote toggled on.
      await expect(
        leadCard.getByRole('button', { name: /Remove your rocket reaction/i })
      ).toBeVisible({ timeout: 10_000 });

      // Alice sees the same rocket reaction propagated via the CRDT.
      await expect(
        aliceCard.getByRole('button', { name: /rocket reaction/i })
      ).toBeVisible({ timeout: 10_000 });

      // Switch tabs while picker is open to verify categories work.
      await leadCard.getByRole('button', { name: 'Add a reaction' }).click();
      await expect(search).toBeVisible();
      await leadPage.getByRole('tab', { name: 'Hearts' }).click();
      const orangeHeart = leadPage.getByRole('menuitem', { name: 'React with orange heart' });
      await expect(orangeHeart).toBeVisible();
      await orangeHeart.click();

      await expect(
        leadCard.getByRole('button', { name: /Remove your orange heart reaction/i })
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        aliceCard.getByRole('button', { name: /orange heart reaction/i })
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await aliceCtx.close();
      await leadCtx.close();
    }
  });
});
