import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Floating labels on a canvas board (frontend/src/lib/labels.ts): text placed on
 * the canvas that owns nothing. Boards come from importing a v4 file, so they
 * start in the Group phase with known positions.
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

function canvasFile(label: string, cards: { text: string; pos?: object }[], board: object = {}) {
  return {
    format: 'fast-retro',
    version: 4,
    exportedAt: 1,
    board: {
      label,
      anonymous: true,
      phase: 'group',
      autoSort: true,
      columns: [{ key: 'ok', title: 'Went OK', color: 'amber' }, { key: 'actions', title: 'Action items', color: 'sky' }],
      layout: 'canvas',
      ...board
    },
    cards: { ok: cards.map((c, i) => ({ id: `c${i}`, authorId: '', votes: [], reactions: {}, comments: [], ...c })) }
  };
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

async function join(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  const canvas = page.getByTestId('board-canvas');
  await expect(nameInput.or(canvas)).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await expect(canvas).toBeVisible();
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(gotIt).toBeHidden();
}

async function importJson(page: Page, json: string, name = 'Host') {
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
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  await join(page, name);
}

const labelEl = (page: Page, text: string) => page.getByTestId('canvas-label').filter({ hasText: text });
const worldPos = (el: Locator) =>
  el.evaluate((node) => {
    const m = (node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });

// Somewhere the imported boards have nothing.
async function emptySpot(page: Page, dx = 0, dy = 0) {
  const box = await page.getByTestId('board-canvas').boundingBox();
  return { x: box!.x + box!.width - 340 + dx, y: box!.y + box!.height - 120 + dy };
}

async function addLabel(page: Page, text: string, dx = 0, dy = 0) {
  const spot = await emptySpot(page, dx, dy);
  await page.mouse.dblclick(spot.x, spot.y);
  const input = page.getByLabel('New label');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
  await expect(labelEl(page, text)).toBeVisible();
}

async function dragBy(page: Page, el: Locator, dx: number, dy: number, opts: { release?: boolean } = {}) {
  const box = await el.boundingBox();
  const from = { x: box!.x + 16, y: box!.y + box!.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  if (opts.release !== false) await page.mouse.up();
}

async function saveBoardFile(page: Page) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).first().click();
      await page.getByRole('menuitem', { name: /Save board file/ }).click();
    })()
  ]);
  return readFileSync((await file.path()) as string, 'utf-8');
}

test.describe('canvas labels', () => {
  test('anyone adds, moves, edits and deletes a label, everyone sees it, and no card moves', async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      const card = `Card ${s}`;
      await importJson(host.page, JSON.stringify(canvasFile(`Labels ${s}`, [{ text: card, pos: { x: 0, y: 100, z: 1 } }])));
      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');

      // A participant adds one.
      const text = `Deploys ${s}`;
      await addLabel(peer.page, text);
      await expect(labelEl(host.page, text)).toBeVisible();

      // Escape, and leaving it empty, add nothing.
      const spot = await emptySpot(host.page, 0, -300);
      await host.page.mouse.dblclick(spot.x, spot.y);
      await host.page.getByLabel('New label').fill('Never mind');
      await host.page.getByLabel('New label').press('Escape');
      await host.page.mouse.dblclick(spot.x, spot.y);
      await host.page.getByLabel('New label').press('Enter');
      await expect(host.page.getByTestId('canvas-label')).toHaveCount(1);

      // The host drags it: live for the peer, saved on drop, and the card stays.
      const cardEl = host.page.getByTestId('canvas-card').filter({ hasText: card });
      const cardBefore = await worldPos(cardEl);
      const start = await worldPos(labelEl(peer.page, text));
      await dragBy(host.page, labelEl(host.page, text), -150, -80, { release: false });
      await expect(labelEl(peer.page, text)).toHaveAttribute('data-live', '');
      await expect.poll(async () => (await worldPos(labelEl(peer.page, text)))!.x).toBeLessThan(start!.x - 40);
      await host.page.mouse.up();
      await expect(labelEl(peer.page, text)).not.toHaveAttribute('data-live', '');
      const dropped = await worldPos(labelEl(host.page, text));
      await expect.poll(() => worldPos(labelEl(peer.page, text))).toEqual(dropped);
      expect(await worldPos(cardEl)).toEqual(cardBefore);

      // A click edits, and doesn't move it.
      const box = await labelEl(peer.page, text).boundingBox();
      await peer.page.mouse.click(box!.x + 16, box!.y + box!.height / 2);
      const input = peer.page.getByLabel('Label text');
      await expect(input).toBeFocused();
      await input.fill(`Renamed ${s}`);
      await input.press('Enter');
      await expect(labelEl(host.page, `Renamed ${s}`)).toBeVisible();
      expect(await worldPos(labelEl(host.page, `Renamed ${s}`))).toEqual(dropped);

      // Shift + arrows nudge a focused label.
      await labelEl(host.page, `Renamed ${s}`).focus();
      await host.page.keyboard.press('Shift+ArrowRight');
      await expect.poll(async () => (await worldPos(labelEl(peer.page, `Renamed ${s}`)))!.x).toBe(dropped!.x + 20);

      // Clearing the text deletes it, and so does the button.
      const b2 = await labelEl(host.page, `Renamed ${s}`).boundingBox();
      await host.page.mouse.click(b2!.x + 16, b2!.y + b2!.height / 2);
      await host.page.getByLabel('Label text').fill('');
      await host.page.getByLabel('Label text').press('Enter');
      await expect(peer.page.getByTestId('canvas-label')).toHaveCount(0);

      await addLabel(host.page, `Second ${s}`);
      await labelEl(host.page, `Second ${s}`).hover();
      await host.page.getByRole('button', { name: `Delete label: Second ${s}` }).click();
      await expect(peer.page.getByTestId('canvas-label')).toHaveCount(0);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('labels are hidden in Brainstorm and come back, and Fit counts them', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      const file = canvasFile(`Hidden ${s}`, [{ text: `Card ${s}` }], {
        labels: [{ text: `Far label ${s}`, x: 3000, y: 2000 }]
      });
      await importJson(page, JSON.stringify(file));
      await expect(labelEl(page, `Far label ${s}`)).toBeVisible();
      const canvas = await page.getByTestId('board-canvas').boundingBox();
      const box = await labelEl(page, `Far label ${s}`).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);

      await page.getByRole('button', { name: /Go back to Brainstorm/ }).click();
      await expect(page.getByTestId('canvas-label')).toHaveCount(0);
      // In Brainstorm a double-click writes a card, not a label.
      const spot = await emptySpot(page);
      await page.mouse.dblclick(spot.x, spot.y);
      await expect(page.getByTestId('canvas-draft')).toBeVisible();
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /Advance to Group/ }).click();
      await expect(labelEl(page, `Far label ${s}`)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('labels survive export and re-import, ending, and the archive, but not Start next retro', async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      await importJson(page, JSON.stringify(canvasFile(`Keep ${s}`, [{ text: `Card ${s}` }])));
      await addLabel(page, `Kept ${s}`);
      const at = await worldPos(labelEl(page, `Kept ${s}`));

      const exported = await saveBoardFile(page);
      const parsed = JSON.parse(exported);
      expect(parsed.board.labels).toEqual([{ text: `Kept ${s}`, x: at!.x, y: at!.y }]);
      // Labels store no author, on any board.
      expect(Object.keys(parsed.board.labels[0]).sort()).toEqual(['text', 'x', 'y']);

      const copy = await newPage(browser);
      try {
        await importJson(copy.page, exported);
        await expect(labelEl(copy.page, `Kept ${s}`)).toBeVisible();
        expect(await worldPos(labelEl(copy.page, `Kept ${s}`))).toEqual(at);
      } finally {
        await copy.ctx.close();
      }

      await page.getByRole('button', { name: /End retro/ }).first().click();
      await page.getByRole('button', { name: 'Archive & end' }).click();
      await expect(page.getByText('This retro has ended')).toBeVisible();

      // Ended: still there, not editable, and pointing at it pans instead.
      const label = labelEl(page, `Kept ${s}`);
      await expect(label).toBeVisible();
      await expect(page.getByRole('button', { name: `Delete label: Kept ${s}` })).toHaveCount(0);
      const box = await label.boundingBox();
      await page.mouse.click(box!.x + 16, box!.y + box!.height / 2);
      await expect(page.getByLabel('Label text')).toHaveCount(0);
      const spot = await emptySpot(page);
      await page.mouse.dblclick(spot.x, spot.y);
      await expect(page.getByLabel('New label')).toHaveCount(0);

      if (LEAD_TOKEN) {
        const admin = await newPage(browser);
        try {
          await admin.page.goto(`/lead/${LEAD_TOKEN}/archives`);
          const item = admin.page.getByTestId('archive-item').filter({ hasText: `Keep ${s}` }).first();
          await expect(item).toBeVisible({ timeout: 10_000 });
          await item.getByRole('link').first().click();
          const [file] = await Promise.all([
            admin.page.waitForEvent('download'),
            admin.page.getByRole('button', { name: 'Save board file' }).click()
          ]);
          const archived = JSON.parse(readFileSync((await file.path()) as string, 'utf-8'));
          expect(archived.board.labels).toEqual([{ text: `Kept ${s}`, x: at!.x, y: at!.y }]);
        } finally {
          await admin.ctx.close();
        }
      }

      const endedUrl = page.url();
      await page.getByRole('button', { name: 'Start next retro' }).click();
      await page.waitForURL((url) => url.href !== endedUrl);
      await expect(page.getByText('This retro has ended')).toBeHidden();
      await expect(page.getByTestId('board-canvas')).toBeVisible();
      await page.getByRole('button', { name: /Advance to Group/ }).click();
      await expect(page.getByTestId('canvas-label')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
