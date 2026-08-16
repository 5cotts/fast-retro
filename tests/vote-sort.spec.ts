import { test, expect, type Page } from '@playwright/test';

/**
 * Vote-phase sort: from the Vote phase onward, cards in a column are
 * displayed highest-votes-first (display-only — the underlying card
 * order is untouched). Brainstorm/Group phases render in insertion
 * order regardless of vote count (votes can only be 0 before Vote).
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

async function columnCardOrder(page: Page): Promise<string[]> {
  const groups = page.getByRole('list', { name: 'What went well' }).getByRole('group');
  const labels = await groups.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? '')
  );
  return labels;
}

test.describe('fast-retro vote-phase card sort', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('cards sort by vote count from the Vote phase onward, not before', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-vote-sort-${Date.now()}`;
    const stamp = Date.now();
    const leadName = `lead-${Math.random().toString(36).slice(2, 6)}`;
    const aliceName = `alice-${Math.random().toString(36).slice(2, 6)}`;
    const cardA = `alpha card ${stamp}`;
    const cardB = `bravo card ${stamp}`;
    const cardC = `charlie card ${stamp}`;

    const leadCtx = await browser.newContext();
    const aliceCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    try {
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, leadName);
      await joinAs(alicePage, `/board/${slug}`, aliceName);

      // Add cards in order A, B, C during Brainstorm.
      const draft = leadPage.getByLabel('Add a card to What went well');
      const leadColumn = leadPage.getByRole('list', { name: 'What went well' });
      for (const text of [cardA, cardB, cardC]) {
        await draft.fill(text);
        await leadColumn.getByRole('button', { name: 'Add card', exact: true }).click();
        await expect(leadColumn.getByRole('group', { name: `Card: ${text}` })).toBeVisible();
      }
      await expect(alicePage.getByRole('list', { name: 'What went well' }).getByRole('group', { name: `Card: ${cardC}` })).toBeVisible({ timeout: 10_000 });

      // Brainstorm: insertion order, unaffected by (zero) votes.
      let order = await columnCardOrder(leadPage);
      expect(order).toEqual([`Card: ${cardA}`, `Card: ${cardB}`, `Card: ${cardC}`]);

      // Advance Brainstorm → Group: order still untouched.
      await leadPage.getByRole('button', { name: 'Advance to Group phase' }).click();
      await expect(leadPage.getByRole('button', { name: 'Advance to Vote phase' })).toBeVisible();
      order = await columnCardOrder(leadPage);
      expect(order).toEqual([`Card: ${cardA}`, `Card: ${cardB}`, `Card: ${cardC}`]);

      // Advance Group → Vote.
      await leadPage.getByRole('button', { name: 'Advance to Vote phase' }).click();
      await expect(leadPage.getByRole('button', { name: 'Advance to Discuss phase' })).toBeVisible();
      await expect(alicePage.getByRole('list', { name: 'What went well' }).getByRole('button', { name: /^Upvote/ }).first()).toBeEnabled({ timeout: 10_000 });

      // Cast votes: C gets 2 (lead + alice), B gets 1 (lead), A gets 0.
      const leadCardC = leadColumn.getByRole('group', { name: `Card: ${cardC}` });
      const leadCardB = leadColumn.getByRole('group', { name: `Card: ${cardB}` });
      const aliceColumn = alicePage.getByRole('list', { name: 'What went well' });
      const aliceCardC = aliceColumn.getByRole('group', { name: `Card: ${cardC}` });

      await leadCardC.getByRole('button', { name: /^Upvote/ }).click();
      await leadCardB.getByRole('button', { name: /^Upvote/ }).click();
      await aliceCardC.getByRole('button', { name: /^Upvote/ }).click();

      await expect(leadCardC.getByRole('button', { name: /^Remove vote \(2\)/ })).toBeVisible({ timeout: 10_000 });
      await expect(leadCardB.getByRole('button', { name: /^Remove vote \(1\)/ })).toBeVisible({ timeout: 10_000 });

      // Sorted highest-votes-first on both the lead's and Alice's pages.
      order = await columnCardOrder(leadPage);
      expect(order).toEqual([`Card: ${cardC}`, `Card: ${cardB}`, `Card: ${cardA}`]);
      order = await columnCardOrder(alicePage);
      expect(order).toEqual([`Card: ${cardC}`, `Card: ${cardB}`, `Card: ${cardA}`]);

      // Manual drag-reposition is disabled once sorting is active: the
      // card is no longer draggable.
      const leadCardA = leadColumn.getByRole('group', { name: `Card: ${cardA}` });
      await expect(leadCardA).toHaveAttribute('draggable', 'false');
    } finally {
      await aliceCtx.close();
      await leadCtx.close();
    }
  });
});
