import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Boards with custom columns (frontend/src/lib/columns.ts): a board file with
 * its own column list (v2) imports into a board that renders those columns
 * for everyone, accepts cards in every input column during Brainstorm,
 * merges across columns, exports and re-imports with the same columns, ends
 * into an archive that keeps them, and carries them into the next retro.
 *
 * The board is created by importing from the homepage, so the browser is
 * host via its host key. The archive viewer check needs RETRO_LEAD_TOKEN.
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

const PROBLEMS = [
  'How might we cut onboarding time for new hires?',
  'How might we make deploys boring?',
  'How might we make on-call less painful?',
  'How might we keep docs up to date?',
  'How might we have fewer meetings?'
];
const ALL_TITLES = [...PROBLEMS, 'Action items'];

function brainstormFile(suffix: string, seedCard: string) {
  const keys = PROBLEMS.map((_, i) => `c-p${i}${suffix}`);
  return {
    format: 'fast-retro',
    version: 2,
    exportedAt: Date.now(),
    board: {
      label: `Brainstorm ${suffix}`,
      anonymous: false,
      phase: 'brainstorm',
      autoSort: true,
      columns: [
        ...PROBLEMS.map((title, i) => ({ key: keys[i], title })),
        { key: 'actions', title: 'Action items', color: 'sky' }
      ]
    },
    names: { u_seed: 'Seeder' },
    cards: {
      [keys[0]]: [{ id: 'x', text: seedCard, authorId: 'u_seed', votes: ['u_seed'], reactions: {}, comments: [] }],
      actions: []
    }
  };
}

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function joinIfAsked(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput.or(page.getByTestId('board-columns'))).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  await dismissOnboardingIfPresent(page);
  await expect(page.getByTestId('board-columns')).toBeVisible();
}

async function columnTitles(page: Page): Promise<string[]> {
  return page
    .getByTestId('board-columns')
    .locator(':scope > section')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

function column(page: Page, title: string) {
  return page.getByRole('list', { name: title, exact: true });
}

function card(page: Page, title: string, text: string) {
  return column(page, title).getByRole('group', { name: `Card: ${text}` });
}

async function addCard(page: Page, title: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${title}`, { exact: true });
  await draft.click();
  await draft.fill(text);
  await column(page, title).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(card(page, title, text)).toBeVisible();
}

async function openNewRetroDialog(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  return page.getByRole('dialog', { name: 'Start a new retro' });
}

async function importFile(page: Page, name: string, json: string) {
  const dialog = await openNewRetroDialog(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Import from file…' }).click()
  ]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(dialog.getByRole('status', { name: 'Import preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
}

async function download(page: Page, item: RegExp): Promise<string> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).first().click();
      await page.getByRole('menuitem', { name: item }).click();
    })()
  ]);
  return readFileSync((await file.path()) as string, 'utf-8');
}

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: `Advance to ${label} phase` }).click();
  await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })).toBeVisible();
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe('fast-retro custom columns', () => {
  test('a five-column brainstorm board works end to end', async ({ browser }) => {
    test.setTimeout(150_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const seedCard = `seeded idea ${suffix}`;
    const ideas = PROBLEMS.map((_, i) => `idea ${i} ${suffix}`);

    const host = await newPage(browser);
    const guest = await newPage(browser);
    const contexts = [host.ctx, guest.ctx];
    try {
      await importFile(host.page, 'brainstorm.fastretro.json', JSON.stringify(brainstormFile(suffix, seedCard)));
      await joinIfAsked(host.page, `Host ${suffix}`);
      expect(await columnTitles(host.page)).toEqual(ALL_TITLES);
      await expect(card(host.page, PROBLEMS[0], seedCard)).toBeVisible();

      // A second participant sees the same columns and can add to every
      // input column during Brainstorm, but not to Action items yet.
      await guest.page.goto(host.page.url());
      await joinIfAsked(guest.page, `Guest ${suffix}`);
      expect(await columnTitles(guest.page)).toEqual(ALL_TITLES);
      for (const [i, title] of PROBLEMS.entries()) await addCard(guest.page, title, ideas[i]);
      await expect(guest.page.getByLabel('Add a card to Action items')).toHaveCount(0);
      await expect(column(guest.page, 'Action items')).toContainText('Action items open in the Actions phase.');
      for (const [i, title] of PROBLEMS.entries()) {
        await expect(card(host.page, title, ideas[i])).toBeVisible({ timeout: 10_000 });
      }

      // Six columns don't fit at 1280px, so the board scrolls sideways.
      const grid = host.page.getByTestId('board-columns');
      expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

      // Cards survive a reload.
      await guest.page.reload();
      await joinIfAsked(guest.page, `Guest ${suffix}`);
      await expect(card(guest.page, PROBLEMS[4], ideas[4])).toBeVisible();

      // Merging works across custom columns.
      await advance(host.page, 'Group');
      await card(host.page, PROBLEMS[1], ideas[1]).dragTo(card(host.page, PROBLEMS[0], ideas[0]));
      const merged = column(host.page, PROBLEMS[0]).getByRole('group', { name: /^Card: / }).filter({ hasText: ideas[0] });
      await expect(merged).toContainText(ideas[1], { timeout: 10_000 });
      await expect(column(host.page, PROBLEMS[1]).getByRole('group', { name: /^Card: / })).toHaveCount(0);

      // Export: a v2 file with the same columns, and a CSV with their titles.
      const file = JSON.parse(await download(host.page, /^Save board file/));
      expect(file.version).toBe(2);
      expect(file.board.columns.map((c: { title: string }) => c.title)).toEqual(ALL_TITLES);
      const csv = await download(host.page, /^Spreadsheet \(CSV\)/);
      expect(csv).toContain(`${PROBLEMS[2]},${ideas[2]},0,,`);

      // The export imports into another board with the same columns and cards.
      const again = await newPage(browser);
      contexts.push(again.ctx);
      await importFile(again.page, 'again.fastretro.json', JSON.stringify(file));
      await joinIfAsked(again.page, `Again ${suffix}`);
      expect(await columnTitles(again.page)).toEqual(ALL_TITLES);
      await expect(card(again.page, PROBLEMS[3], ideas[3])).toBeVisible();
      await expect(column(again.page, PROBLEMS[0]).getByRole('group', { name: /^Card: / })).toHaveCount(2);

      // End the retro. The archive keeps the columns.
      await host.page.getByRole('button', { name: 'End retro' }).click();
      await host.page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      await expect(host.page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      const boardUrl = host.page.url();

      if (LEAD_TOKEN) {
        const admin = await newPage(browser);
        contexts.push(admin.ctx);
        await admin.page.goto(`/lead/${LEAD_TOKEN}/archives`);
        const item = admin.page.getByTestId('archive-item').filter({ hasText: `Brainstorm ${suffix}` }).first();
        await expect(item).toBeVisible({ timeout: 10_000 });
        await item.getByRole('link').first().click();
        await expect(admin.page.getByTestId('archive-card').filter({ hasText: ideas[4] })).toBeVisible();
        const archiveTitles = await admin.page
          .locator('section[aria-label]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
        expect(archiveTitles).toEqual(ALL_TITLES);
      }

      // Start next retro keeps the columns, on a fresh empty board.
      await host.page.getByRole('button', { name: 'Start next retro' }).click();
      await host.page.waitForURL((u) => u.toString() !== boardUrl && /\/board\//.test(u.pathname));
      await joinIfAsked(host.page, `Host ${suffix}`);
      expect(await columnTitles(host.page)).toEqual(ALL_TITLES);
      await expect(host.page.getByTestId('board-columns').getByRole('group', { name: /^Card: / })).toHaveCount(0);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('a classic board still has the three retro columns and exports as v1', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const dialog = await openNewRetroDialog(page);
      await dialog.getByLabel('Retro name').fill(`Classic ${Math.random().toString(36).slice(2, 6)}`);
      await dialog.getByRole('button', { name: 'Create retro' }).click();
      await page.waitForURL(/\/board\//);
      await joinIfAsked(page, 'Classic host');
      expect(await columnTitles(page)).toEqual(['What went well', 'What to improve', 'Action items']);
      const grid = page.getByTestId('board-columns');
      expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await addCard(page, 'What went well', 'classic card');
      const file = JSON.parse(await download(page, /^Save board file/));
      expect(file.version).toBe(1);
      expect(file.board.columns).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });
});
