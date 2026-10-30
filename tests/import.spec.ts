import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

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

// Opens Start a new retro on the homepage. Seeds a recent board so the
// homepage renders the CTA instead of auto-redirecting an empty-state visitor
// straight to a fresh board.
async function openNewRetroDialog(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  return page.getByRole('dialog', { name: 'Start a new retro' });
}

type FileInput = string | { name: string; mimeType: string; buffer: Buffer };

async function pickImportFile(page: Page, dialog: Locator, file: FileInput) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Import from file…' }).click()
  ]);
  await chooser.setFiles(file);
}

// Imports `file` through the homepage modal in a brand-new browser context,
// so nothing (identity, host keys, names) carries over from the source board.
async function importInFreshBrowser(browser: Browser, file: FileInput, opts: { label: string; preview: RegExp }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const dialog = await openNewRetroDialog(page);
  await pickImportFile(page, dialog, file);
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

        // An original participant opening the imported board still owns
        // their cards and votes: user IDs carry over, only card IDs change.
        await alice.goto(page.url());
        await dismissOnboardingIfPresent(alice);
        const aliceHigh = cardLocator(alice, 'What went well', highVotes);
        await expect(aliceHigh.getByRole('button', { name: 'Remove vote (2)' })).toBeVisible({ timeout: 10_000 });
        await expect(aliceHigh.getByText('you', { exact: true })).toBeVisible();
        await expect(aliceHigh.getByRole('button', { name: 'Edit card' })).toHaveCount(1);
        const aliceLow = cardLocator(alice, 'What went well', lowVotes);
        await expect(aliceLow.getByRole('button', { name: 'Voting closed (1 votes)' })).toBeVisible();
        await expect(aliceLow.getByText(leadName, { exact: true })).toBeVisible();
        await expect(aliceLow.getByRole('button', { name: 'Edit card' })).toHaveCount(0);
        await expect(
          cardLocator(alice, 'What to improve', improve).getByText('you', { exact: true })
        ).toBeVisible();
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

  test('a retro exported from its archive imports', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-import-archive-${Date.now()}`;
    const suffix = Math.random().toString(36).slice(2, 6);
    const leadName = `Archived Lead ${suffix}`;
    const cardText = `archived card ${suffix}`;

    const leadCtx = await browser.newContext();
    const lead = await leadCtx.newPage();
    try {
      await lead.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await join(lead, leadName);
      await addCard(lead, 'What went well', cardText);
      await advance(lead, 'Group');
      await advance(lead, 'Vote');
      const card = cardLocator(lead, 'What went well', cardText);
      await card.getByRole('button', { name: /^Upvote/ }).click();
      await expect(card.getByRole('button', { name: 'Remove vote (1)' })).toBeVisible();

      await lead.getByRole('button', { name: 'End retro' }).click();
      const endDialog = lead.getByRole('alertdialog');
      await endDialog.getByRole('button', { name: 'Archive & end' }).click();
      await expect(lead.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });

      await lead.goto(`/lead/${LEAD_TOKEN}/archives`);
      const item = lead.getByTestId('archive-item').filter({ hasText: slug }).first();
      await expect(item).toBeVisible({ timeout: 10_000 });
      await item.getByRole('link').first().click();
      await expect(lead.getByTestId('archive-card').filter({ hasText: cardText })).toBeVisible();
      const path = await downloadJSON(lead);

      const { ctx, page } = await importInFreshBrowser(browser, path, {
        label: `From archive ${suffix}`,
        preview: /1 card · 0 comments · 1 vote · 0 reactions · names restored/
      });
      try {
        await expect(
          page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: 'Vote' })
        ).toBeVisible({ timeout: 10_000 });
        const imported = cardLocator(page, 'What went well', cardText);
        await expect(imported.getByRole('button', { name: 'Upvote (1)' })).toBeVisible();
        await expect(imported.getByText(leadName, { exact: true })).toBeVisible();
        await expect(page.getByText('This retro has ended')).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    } finally {
      await leadCtx.close();
    }
  });
});

// Bad files must be rejected in the preview with a readable reason, never
// create a board, and never throw in the page. No lead token needed.
test.describe('fast-retro JSON import errors', () => {
  let pageErrors: Error[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
  });
  test.afterEach(() => {
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  });

  const goodFile = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: 'fast-retro',
      version: 1,
      exportedAt: Date.now(),
      board: { label: 'Good file', anonymous: false, phase: 'discuss', autoSort: true },
      cards: {
        wentWell: [{ id: 'c1', text: 'good card', authorId: '', votes: [], reactions: {}, comments: [] }],
        toImprove: [],
        actions: []
      },
      ...overrides
    });

  const asFile = (name: string, contents: string | Buffer, mimeType = 'application/json') => ({
    name,
    mimeType,
    buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf-8')
  });

  async function expectRejected(page: Page, dialog: Locator, message: string | RegExp) {
    await expect(dialog.getByRole('status', { name: 'Import preview' })).toContainText(message);
    const submit = dialog.getByRole('button', { name: 'Create retro' });
    await expect(submit).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Import retro' })).toHaveCount(0);
    // Enter in the name field must not sneak past the disabled button.
    await dialog.getByLabel('Retro name').press('Enter');
    await expect(dialog).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  }

  const rejections: { name: string; file: () => ReturnType<typeof asFile>; error: string | RegExp }[] = [
    {
      name: 'a truncated export',
      file: () => {
        const text = goodFile();
        return asFile('cut-off.fastretro.json', text.slice(0, Math.floor(text.length / 2)));
      },
      error: "This file isn't valid JSON."
    },
    {
      name: 'an old CSV export',
      file: () =>
        asFile(
          'retro-123.csv',
          'column,card_text,votes,reactions,comments\r\nWhat went well,good card,1,,\r\n',
          'text/csv'
        ),
      error: "This file isn't valid JSON."
    },
    {
      name: 'JSON that is not a fast-retro export',
      file: () => asFile('not-a-board.json', JSON.stringify({ hello: 'world' })),
      error: "This isn't a fast-retro export. Use a .fastretro.json file from Download JSON."
    },
    {
      name: 'a file from a newer version',
      file: () => asFile('future.fastretro.json', goodFile({ version: 99 })),
      error: 'This file was exported by a newer version of fast-retro.'
    },
    {
      name: 'a file over 1 MB',
      file: () =>
        asFile(
          'huge.fastretro.json',
          goodFile({ padding: 'x'.repeat(1024 * 1024) })
        ),
      error: 'This file is too large to import (over 1 MB).'
    }
  ];

  for (const r of rejections) {
    test(`rejects ${r.name}`, async ({ page }) => {
      const dialog = await openNewRetroDialog(page);
      await pickImportFile(page, dialog, r.file());
      await expectRejected(page, dialog, r.error);
    });
  }

  test('imports the good parts of a partly broken file, with warnings', async ({ page }) => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const goodText = `survivor ${suffix}`;
    const file = goodFile({
      board: { label: `Partly broken ${suffix}`, anonymous: false, phase: 'celebrate', autoSort: true },
      cards: {
        wentWell: [
          { id: 'c1', text: goodText, authorId: '', votes: [], reactions: {}, comments: [] },
          { id: 'c2', votes: [] },
          'not even a card'
        ],
        toImprove: [],
        actions: []
      }
    });
    const dialog = await openNewRetroDialog(page);
    await pickImportFile(page, dialog, asFile('partly-broken.fastretro.json', file));
    const preview = dialog.getByRole('status', { name: 'Import preview' });
    await expect(preview).toContainText('1 card');
    await expect(preview).toContainText('Unknown phase; the board will start in Brainstorm.');
    await expect(preview).toContainText('Skipped 2 cards with no text.');
    await expect(dialog.getByLabel('Retro name')).toHaveValue(`Partly broken ${suffix}`);

    await dialog.getByRole('button', { name: 'Import retro' }).click();
    await page.waitForURL(/\/board\//);
    await join(page, `importer-${suffix}`);
    await expect(cardLocator(page, 'What went well', goodText)).toBeVisible({ timeout: 10_000 });
    expect(await cardOrder(page, 'What went well')).toEqual([goodText]);
    await expect(
      page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: 'Brainstorm' })
    ).toBeVisible();
  });

  test('recovers after a bad file: Remove clears it, and a good file replaces it', async ({ page }) => {
    const dialog = await openNewRetroDialog(page);
    const preview = dialog.getByRole('status', { name: 'Import preview' });

    await pickImportFile(page, dialog, asFile('bad.json', '{ nope'));
    await expectRejected(page, dialog, "This file isn't valid JSON.");
    await preview.getByRole('button', { name: 'Remove' }).click();
    await expect(preview).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Create retro' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Skip naming' })).toBeVisible();

    await pickImportFile(page, dialog, asFile('bad-again.json', JSON.stringify([1, 2, 3])));
    await expectRejected(page, dialog, "This isn't a fast-retro export.");
    await pickImportFile(page, dialog, asFile('good.fastretro.json', goodFile()));
    await expect(preview).toContainText('good.fastretro.json');
    await expect(preview).toContainText('1 card');
    await expect(preview).not.toContainText("isn't a fast-retro export");
    await expect(dialog.getByRole('button', { name: 'Import retro' })).toBeEnabled();
    await expect(dialog.getByLabel('Retro name')).toHaveValue('Good file');
  });
});
