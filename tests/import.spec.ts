import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Export → import round trip (frontend/src/lib/boardfile.ts, importBoard in
 * yboard.ts, "Import from file…" in NewRetroModal.svelte). A board exported
 * with Download JSON and imported in a fresh browser must look the same:
 * cards and order per column, votes, reactions, comments, author names,
 * phase and settings, and stay that way after a reload.
 *
 * Skipped unless RETRO_LEAD_TOKEN is set (the source board uses the lead route).
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function join(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole('button', { name: 'Join the retro' }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole('list', { name: 'What went well' })).toBeVisible();
}

async function addCard(page: Page, columnTitle: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${columnTitle}`);
  await draft.click();
  await draft.fill(text);
  const column = page.getByRole('list', { name: columnTitle });
  await column.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(column.getByRole('group', { name: `Card: ${text}` })).toBeVisible();
}

function cardLocator(page: Page, columnTitle: string, text: string) {
  return page.getByRole('list', { name: columnTitle }).getByRole('group', { name: `Card: ${text}` });
}

async function cardOrder(page: Page, columnTitle: string): Promise<string[]> {
  const labels = await page
    .getByRole('list', { name: columnTitle })
    .getByRole('group', { name: /^Card: / })
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  return labels.map((l) => l.replace(/^Card: /, ''));
}

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: `Advance to ${label} phase` }).click();
  await expect(
    page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })
  ).toBeVisible();
}

async function downloadJSON(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JSON' }).click()
  ]);
  return (await download.path()) as string;
}

// Imports `path` through the homepage modal in a brand-new browser context,
// so nothing (identity, host keys, names) carries over from the source board.
async function importInFreshBrowser(browser: Browser, path: string, opts: { label: string; preview: RegExp }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Seed a recent board so the homepage renders the CTA instead of
  // auto-redirecting an empty-state visitor straight to a fresh board.
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Import from file…' }).click()
  ]);
  await chooser.setFiles(path);
  await expect(dialog.getByRole('status', { name: 'Import preview' })).toContainText(opts.preview);
  await dialog.getByLabel('Retro name').fill(opts.label);
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  await join(page, `importer-${Math.random().toString(36).slice(2, 6)}`);
  return { ctx, page };
}

test.describe('fast-retro JSON import', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('an exported board imports into a new board that looks the same', async ({ browser }) => {
    test.setTimeout(120_000);

    const slug = `pw-import-${Date.now()}`;
    const suffix = Math.random().toString(36).slice(2, 6);
    const leadName = `Lead ${suffix}`;
    const aliceName = `Alice ${suffix}`;
    const lowVotes = `low votes, "quoted" 🎉 ${suffix}`;
    const highVotes = `high votes ${suffix}`;
    const improve = `=SUM(A1) improve ${suffix}`;
    const action = `ship it ${suffix}`;
    const comment = `agreed, "really" ${suffix}`;

    const leadCtx = await browser.newContext();
    const aliceCtx = await browser.newContext();
    const lead = await leadCtx.newPage();
    const alice = await aliceCtx.newPage();

    try {
      await lead.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await join(lead, leadName);
      await alice.goto(`/board/${slug}`);
      await join(alice, aliceName);

      await addCard(lead, 'What went well', lowVotes);
      await addCard(alice, 'What went well', highVotes);
      await addCard(alice, 'What to improve', improve);

      await advance(lead, 'Group');
      await advance(lead, 'Vote');
      await cardLocator(lead, 'What went well', lowVotes).getByRole('button', { name: /^Upvote/ }).click();
      await cardLocator(lead, 'What went well', highVotes).getByRole('button', { name: /^Upvote/ }).click();
      await cardLocator(alice, 'What went well', highVotes).getByRole('button', { name: /^Upvote/ }).click();
      await expect(
        cardLocator(lead, 'What went well', highVotes).getByRole('button', { name: /^Remove vote \(2\)/ })
      ).toBeVisible({ timeout: 10_000 });

      await advance(lead, 'Discuss');
      {
        const card = cardLocator(alice, 'What went well', lowVotes);
        await card.getByRole('button', { name: 'Add a reaction', exact: true }).click();
        await alice.getByLabel('Search emoji').fill('party');
        await alice.getByRole('menuitem', { name: 'React with party', exact: true }).click();
        await expect(card.getByRole('button', { name: /Remove your party reaction \(1/ })).toBeVisible();
        await card.getByRole('button', { name: /Comments/ }).click();
        await card.getByPlaceholder('Add a comment…').fill(comment);
        await card.getByRole('button', { name: 'Post' }).click();
        await expect(card.getByText(comment)).toBeVisible();
      }
      await advance(lead, 'Actions');
      await addCard(lead, 'Action items', action);
      await expect(
        cardLocator(lead, 'What went well', lowVotes).getByRole('button', { name: /Comments \(1\)/ })
      ).toBeVisible({ timeout: 10_000 });

      const before = {
        wentWell: await cardOrder(lead, 'What went well'),
        toImprove: await cardOrder(lead, 'What to improve'),
        actions: await cardOrder(lead, 'Action items')
      };
      // Auto-sort is on and we're past Vote, so the 2-vote card shows first.
      expect(before.wentWell).toEqual([highVotes, lowVotes]);

      const path = await downloadJSON(lead);
      const file = JSON.parse(readFileSync(path, 'utf-8'));
      expect(file.board).toMatchObject({ anonymous: false, phase: 'actions', autoSort: true });

      const imported = await importInFreshBrowser(browser, path, {
        label: `Imported ${suffix}`,
        preview: /4 cards · 1 comment · 3 votes · 1 reaction · names restored/
      });
      const page = imported.page;
      try {
        const check = async () => {
          await expect(page).toHaveTitle(new RegExp(`Imported ${suffix}`));
          await expect(
            page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: 'Actions' })
          ).toBeVisible({ timeout: 10_000 });
          await expect(cardLocator(page, 'Action items', action)).toBeVisible({ timeout: 10_000 });
          expect(await cardOrder(page, 'What went well')).toEqual(before.wentWell);
          expect(await cardOrder(page, 'What to improve')).toEqual(before.toImprove);
          expect(await cardOrder(page, 'Action items')).toEqual(before.actions);

          const low = cardLocator(page, 'What went well', lowVotes);
          const high = cardLocator(page, 'What went well', highVotes);
          await expect(high.getByRole('button', { name: 'Voting closed (2 votes)' })).toBeVisible();
          await expect(low.getByRole('button', { name: 'Voting closed (1 votes)' })).toBeVisible();
          await expect(low.getByRole('button', { name: 'Add party reaction (1 so far)' })).toBeVisible();
          await expect(low.getByText(leadName, { exact: true })).toBeVisible();
          await expect(high.getByText(aliceName, { exact: true })).toBeVisible();
          await expect(cardLocator(page, 'What to improve', improve).getByText(aliceName, { exact: true })).toBeVisible();

          const commentsBtn = low.getByRole('button', { name: 'Comments (1)' });
          await expect(commentsBtn).toBeVisible();
          // Card.svelte opens the panel by default for cards that have comments.
          if (!(await low.getByPlaceholder('Add a comment…').isVisible())) await commentsBtn.click();
          await expect(low.getByText(aliceName, { exact: true }).last()).toBeVisible();
          await expect(low.getByText(comment)).toBeVisible();

          await expect(page.getByRole('button', { name: 'Turn on anonymous mode' })).toBeVisible();
        };
        await check();
        await page.reload();
        await dismissOnboardingIfPresent(page);
        await check();
      } finally {
        await imported.ctx.close();
      }
    } finally {
      await leadCtx.close();
      await aliceCtx.close();
    }
  });

  test('an anonymous board imports without names', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-import-anon-${Date.now()}`;
    const suffix = Math.random().toString(36).slice(2, 6);
    const leadName = `Secret Lead ${suffix}`;
    const cardText = `anonymous card ${suffix}`;

    const leadCtx = await browser.newContext();
    const lead = await leadCtx.newPage();
    try {
      await lead.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await join(lead, leadName);
      await lead.getByRole('button', { name: 'Turn on anonymous mode' }).click();
      await expect(lead.getByRole('button', { name: 'Turn off anonymous mode' })).toBeVisible();
      await addCard(lead, 'What went well', cardText);

      const path = await downloadJSON(lead);
      expect(readFileSync(path, 'utf-8')).not.toContain(leadName);

      const { ctx, page } = await importInFreshBrowser(browser, path, {
        label: `Anon import ${suffix}`,
        preview: /1 card · 0 comments · 0 votes · 0 reactions · anonymous/
      });
      try {
        const card = cardLocator(page, 'What went well', cardText);
        await expect(card).toBeVisible({ timeout: 10_000 });
        await expect(card.getByText('Anonymous', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Turn off anonymous mode' })).toBeVisible();
        await expect(page.getByText(leadName)).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    } finally {
      await leadCtx.close();
    }
  });

  test('a file that is not a fast-retro export is rejected in the preview', async ({ page }, testInfo) => {
    const bad = testInfo.outputPath('not-a-board.json');
    writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    await page.addInitScript(() => {
      localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start a new retro' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dialog.getByRole('button', { name: 'Import from file…' }).click()
    ]);
    await chooser.setFiles(bad);
    await expect(dialog.getByRole('status', { name: 'Import preview' })).toContainText("isn't a fast-retro export");
    await expect(dialog.getByRole('button', { name: 'Create retro' })).toBeDisabled();
  });
});
