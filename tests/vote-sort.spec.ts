import { test, expect, type Page } from '@playwright/test';

/**
 * Discuss-phase auto-sort: once the lead advances into Discuss (and through
 * Actions), cards in a column are displayed highest-votes-first
 * (display-only — the underlying card order is untouched). Brainstorm,
 * Group, and Vote all render in insertion order regardless of vote count —
 * sorting doesn't kick in until Discuss, so a card's position doesn't shift
 * on someone mid-vote. The lead can also disable auto-sort entirely via a
 * toggle (on by default).
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

test.describe('fast-retro discuss-phase auto-sort', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('cards sort by vote count from the Discuss phase onward, not before', async ({ browser }) => {
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

      // Still Vote phase: order untouched by votes, and cards remain draggable.
      order = await columnCardOrder(leadPage);
      expect(order).toEqual([`Card: ${cardA}`, `Card: ${cardB}`, `Card: ${cardC}`]);
      const leadCardA = leadColumn.getByRole('group', { name: `Card: ${cardA}` });
      await expect(leadCardA).toHaveAttribute('draggable', 'true');

      // Advance Vote → Discuss: sort kicks in now, on both the lead's and
      // Alice's pages.
      await leadPage.getByRole('button', { name: 'Advance to Discuss phase' }).click();
      await expect(leadPage.getByRole('button', { name: 'Advance to Actions phase' })).toBeVisible();

      order = await columnCardOrder(leadPage);
      expect(order).toEqual([`Card: ${cardC}`, `Card: ${cardB}`, `Card: ${cardA}`]);
      order = await columnCardOrder(alicePage);
      expect(order).toEqual([`Card: ${cardC}`, `Card: ${cardB}`, `Card: ${cardA}`]);

      // Manual drag-reposition is disabled once sorting is active: the
      // card is no longer draggable.
      await expect(leadCardA).toHaveAttribute('draggable', 'false');
    } finally {
      await aliceCtx.close();
      await leadCtx.close();
    }
  });

  test('lead can disable auto-sort to keep manual order in Discuss', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-vote-sort-toggle-${Date.now()}`;
    const stamp = Date.now();
    const leadName = `lead-${Math.random().toString(36).slice(2, 6)}`;
    const cardA = `alpha card ${stamp}`;
    const cardB = `bravo card ${stamp}`;

    const leadCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();

    try {
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, leadName);

      const draft = leadPage.getByLabel('Add a card to What went well');
      const leadColumn = leadPage.getByRole('list', { name: 'What went well' });
      for (const text of [cardA, cardB]) {
        await draft.fill(text);
        await leadColumn.getByRole('button', { name: 'Add card', exact: true }).click();
        await expect(leadColumn.getByRole('group', { name: `Card: ${text}` })).toBeVisible();
      }

      // Turn auto-sort off up front (default is on).
      const toggle = leadPage.getByRole('button', { name: 'Turn off auto-sort by votes' });
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(leadPage.getByRole('button', { name: 'Turn on auto-sort by votes' })).toBeVisible();

      // Vote B up so it would sort above A if auto-sort were on.
      await leadPage.getByRole('button', { name: 'Advance to Group phase' }).click();
      await leadPage.getByRole('button', { name: 'Advance to Vote phase' }).click();
      const leadCardB = leadColumn.getByRole('group', { name: `Card: ${cardB}` });
      await leadCardB.getByRole('button', { name: /^Upvote/ }).click();
      await expect(leadCardB.getByRole('button', { name: /^Remove vote \(1\)/ })).toBeVisible({ timeout: 10_000 });

      await leadPage.getByRole('button', { name: 'Advance to Discuss phase' }).click();
      await expect(leadPage.getByRole('button', { name: 'Advance to Actions phase' })).toBeVisible();

      // With auto-sort off, insertion order is preserved even in Discuss,
      // and cards stay draggable.
      const order = await columnCardOrder(leadPage);
      expect(order).toEqual([`Card: ${cardA}`, `Card: ${cardB}`]);
      const leadCardA = leadColumn.getByRole('group', { name: `Card: ${cardA}` });
      await expect(leadCardA).toHaveAttribute('draggable', 'true');
    } finally {
      await leadCtx.close();
    }
  });
});
