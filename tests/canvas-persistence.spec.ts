import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * A canvas board's layout and card positions (frontend/src/lib/canvas.ts) survive
 * every way out of a board: Export, re-import, ending it, the archive's download,
 * and Start next retro, which stays a canvas but starts from the grid.
 *
 * Works from the header and files only, so it doesn't depend on which surface
 * draws the board. The archive check needs RETRO_LEAD_TOKEN.
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

const fixture = JSON.parse(readFileSync('frontend/src/lib/fixtures/board-v4.fastretro.json', 'utf-8'));

function canvasFile(suffix: string) {
  return {
    ...fixture,
    board: { ...fixture.board, label: `Canvas ${suffix}` },
    cards: {
      ...fixture.cards,
      actions: [{ id: 'act', text: `Action ${suffix}`, authorId: 'u_alice', votes: [], reactions: {}, comments: [], pos: { x: 1, y: 2, z: 9 } }]
    }
  };
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

async function joinIfAsked(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  const exportButton = page.getByRole('button', { name: 'Export', exact: true }).first();
  await expect(nameInput.or(exportButton)).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(exportButton).toBeVisible();
}

async function importFile(page: Page, json: string, name: string) {
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
  await chooser.setFiles({ name: 'canvas.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(dialog.getByRole('status', { name: 'Import preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  await joinIfAsked(page, name);
}

async function saveBoardFile(page: Page) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).first().click();
      await page.getByRole('menuitem', { name: /Save board file/ }).click();
    })()
  ]);
  return JSON.parse(readFileSync((await file.path()) as string, 'utf-8'));
}

const positions = (file: { cards: Record<string, { text: string; pos?: unknown }[]> }) =>
  Object.fromEntries(Object.entries(file.cards).map(([key, list]) => [key, list.map((c) => [c.text, c.pos ?? null])]));

test.describe('fast-retro canvas persistence', () => {
  test('layout and positions survive export, re-import, ending, the archive and next retro', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const source = canvasFile(suffix);
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importFile(host.page, JSON.stringify(source), `Host ${suffix}`);

      const exported = await saveBoardFile(host.page);
      expect(exported.version).toBe(4);
      expect(exported.board.layout).toBe('canvas');
      expect(positions(exported)).toEqual(positions(source));

      // A second board from that export is the same board.
      const again = await newPage(browser);
      contexts.push(again.ctx);
      await importFile(again.page, JSON.stringify(exported), `Again ${suffix}`);
      const reexported = await saveBoardFile(again.page);
      expect(reexported.board.layout).toBe('canvas');
      expect(positions(reexported)).toEqual(positions(source));

      // Ending keeps them, on the ended board itself.
      await host.page.getByRole('button', { name: 'End retro' }).click();
      await host.page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      await expect(host.page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      const ended = await saveBoardFile(host.page);
      expect(ended.board.layout).toBe('canvas');
      expect(positions(ended)).toEqual(positions(source));

      if (LEAD_TOKEN) {
        const admin = await newPage(browser);
        contexts.push(admin.ctx);
        await admin.page.goto(`/lead/${LEAD_TOKEN}/archives`);
        const item = admin.page.getByTestId('archive-item').filter({ hasText: `Canvas ${suffix}` }).first();
        await expect(item).toBeVisible({ timeout: 10_000 });
        await item.getByRole('link').first().click();
        await expect(admin.page.getByTestId('archive-canvas-tag')).toBeVisible();
        const [file] = await Promise.all([
          admin.page.waitForEvent('download'),
          admin.page.getByRole('button', { name: 'Save board file' }).click()
        ]);
        const archived = JSON.parse(readFileSync((await file.path()) as string, 'utf-8'));
        expect(archived.board.layout).toBe('canvas');
        expect(positions(archived)).toEqual(positions(source));
      }

      // Next retro stays a canvas, and carried action items start from the grid.
      const boardUrl = host.page.url();
      await host.page.getByRole('button', { name: 'Start next retro' }).click();
      await host.page.waitForURL((u) => u.toString() !== boardUrl && /\/board\//.test(u.pathname));
      await joinIfAsked(host.page, `Host ${suffix}`);
      const next = await saveBoardFile(host.page);
      expect(next.version).toBe(4);
      expect(next.board.layout).toBe('canvas');
      expect(next.board.columns).toEqual(source.board.columns);
      expect(positions(next)).toEqual({ 'c-ok': [], 'c-well': [], actions: [[`Action ${suffix}`, null]] });
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('a column board writes no layout or positions', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const file = {
        format: 'fast-retro',
        version: 1,
        exportedAt: 1,
        board: { label: 'Plain', anonymous: true, phase: 'group', autoSort: true },
        cards: { wentWell: [{ id: 'a', text: 'plain card', authorId: '', votes: [], reactions: {}, comments: [], pos: { x: 1, y: 2, z: 3 } }] }
      };
      await importFile(page, JSON.stringify(file), 'Plain');
      const exported = await saveBoardFile(page);
      expect(exported.version).toBe(1);
      expect(exported.board).not.toHaveProperty('layout');
      expect(exported.cards.wentWell[0]).not.toHaveProperty('pos');
    } finally {
      await ctx.close();
    }
  });
});
