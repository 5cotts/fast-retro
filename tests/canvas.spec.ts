import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Canvas boards (frontend/src/lib/CanvasSurface.svelte). There's no "Canvas"
 * option yet, so every board here comes from importing a v4 file. page.mouse
 * drives real pointer events; a card's style.transform is its world position,
 * which is the same for everyone regardless of pan and zoom.
 */
const VIEWPORT = { width: 1400, height: 900 };

interface SeedCard {
  text: string;
  authorId?: string;
  pos?: { x: number; y: number; z: number };
}

function canvasFile(label: string, cards: Record<string, SeedCard[]>, board: object = {}) {
  return {
    format: 'fast-retro',
    version: 4,
    exportedAt: 1,
    board: {
      label,
      anonymous: true,
      phase: 'group',
      autoSort: true,
      columns: [
        { key: 'ok', title: 'Went OK', color: 'amber' },
        { key: 'well', title: 'Went well', color: 'emerald' }
      ],
      layout: 'canvas',
      ...board
    },
    cards: Object.fromEntries(
      Object.entries(cards).map(([key, list]) => [
        key,
        list.map((c, i) => ({ id: `${key}${i}`, authorId: '', votes: [], reactions: {}, comments: [], ...c }))
      ])
    )
  };
}

async function newPage(browser: Browser, viewport = VIEWPORT) {
  const ctx = await browser.newContext({ viewport });
  return { ctx, page: await ctx.newPage() };
}

async function join(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput.or(page.getByTestId('board-canvas'))).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(gotIt).toBeHidden();
}

async function importBoard(page: Page, file: object, name: string) {
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
  await chooser.setFiles({ name: 'canvas.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  await join(page, name);
}

const cardEl = (page: Page, text: string) => page.getByTestId('canvas-card').filter({ hasText: text });
const worldPos = (el: Locator) =>
  el.evaluate((node) => {
    const m = (node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });
const worldTransform = (page: Page) => page.getByTestId('canvas-world').evaluate((n) => (n as HTMLElement).style.transform);

async function center(el: Locator) {
  const box = await el.boundingBox();
  if (!box) throw new Error('not on screen');
  return { x: box.x + box.width / 2, y: box.y + 14 };
}

// Grabs the card by its text line, near the top, away from its buttons.
async function drag(page: Page, el: Locator, dx: number, dy: number, opts: { release?: boolean } = {}) {
  const from = await center(el);
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
  return JSON.parse(readFileSync((await file.path()) as string, 'utf-8'));
}

test.describe('fast-retro canvas', () => {
  test('a drag shows live for the other person, saves on drop and survives a reload', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const text = `Move me ${suffix}`;
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importBoard(host.page, canvasFile(`Live ${suffix}`, { ok: [{ text }, { text: `Neighbor ${suffix}` }] }), 'Host');
      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');

      const onPeer = cardEl(peer.page, text);
      const start = await worldPos(onPeer);
      const neighborBefore = await worldPos(cardEl(host.page, `Neighbor ${suffix}`));
      expect(start).toEqual(await worldPos(cardEl(host.page, text)));

      await drag(host.page, cardEl(host.page, text), 200, 90, { release: false });
      // Not dropped yet: the peer sees it moving, and the doc hasn't changed.
      await expect.poll(async () => (await worldPos(onPeer))!.x).toBeGreaterThan(start!.x + 50);
      await expect(onPeer).toHaveAttribute('data-live', '');
      // Export is host-only on a live board, and the host's mouse is busy, so
      // read the doc from a second host tab.
      const hostTab = await host.ctx.newPage();
      await hostTab.goto(host.page.url());
      await join(hostTab, 'Host');
      const midDragFile = await saveBoardFile(hostTab);
      await hostTab.close();
      expect(midDragFile.cards.ok[0]).not.toHaveProperty('pos');

      await host.page.mouse.up();
      await expect(onPeer).not.toHaveAttribute('data-live', '');
      const dropped = await worldPos(cardEl(host.page, text));
      await expect.poll(() => worldPos(onPeer)).toEqual(dropped);
      expect(dropped!.x).toBeGreaterThan(start!.x);

      // The card next to it keeps its place, and its old slot stays empty.
      expect(await worldPos(cardEl(host.page, `Neighbor ${suffix}`))).toEqual(neighborBefore);

      const file = await saveBoardFile(host.page);
      expect(file.cards.ok[0].pos.x).toBeCloseTo(dropped!.x, 3);
      expect(file.cards.ok[1]).not.toHaveProperty('pos');

      await peer.page.reload();
      await expect(onPeer).toBeVisible();
      await expect.poll(() => worldPos(onPeer)).toEqual(dropped);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('pan and zoom are local, and a drop while zoomed out lands right for someone at another zoom', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const text = `Zoomed ${suffix}`;
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importBoard(host.page, canvasFile(`Zoom ${suffix}`, { ok: [{ text }], well: [{ text: `Far ${suffix}`, pos: { x: 900, y: 500, z: 1 } }] }), 'Host');
      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');
      const peerView = await worldTransform(peer.page);

      // Pan by dragging empty space.
      const hostView = await worldTransform(host.page);
      await host.page.mouse.move(1300, 800);
      await host.page.mouse.down();
      await host.page.mouse.move(1200, 720, { steps: 3 });
      await host.page.mouse.up();
      expect(await worldTransform(host.page)).not.toBe(hostView);

      // Zoom around the pointer: the point under it doesn't move.
      const before = await cardEl(host.page, text).boundingBox();
      // Whole pixels: the browser truncates the event's position, which would shift the anchor.
      await host.page.mouse.move(Math.round(before!.x), Math.round(before!.y));
      await host.page.keyboard.down('Control');
      await host.page.mouse.wheel(0, 120);
      await host.page.keyboard.up('Control');
      await expect(host.page.getByTestId('canvas-zoom')).not.toHaveText(/^100%$/);
      const after = await cardEl(host.page, text).boundingBox();
      expect(after!.x).toBeCloseTo(before!.x, 0);
      expect(after!.y).toBeCloseTo(before!.y, 0);

      // Neither reached the other person.
      expect(await worldTransform(peer.page)).toBe(peerView);

      const zoom = Number((await worldTransform(host.page)).match(/scale\(([\d.]+)\)/)![1]);
      // One mouse-wheel notch is a step, not a jump across the whole range.
      expect(zoom).toBeGreaterThan(0.7);
      const start = await worldPos(cardEl(host.page, text));
      await drag(host.page, cardEl(host.page, text), 100, 50);
      const dropped = await worldPos(cardEl(host.page, text));
      expect(dropped!.x - start!.x).toBeCloseTo(100 / zoom, 0);
      expect(dropped!.y - start!.y).toBeCloseTo(50 / zoom, 0);
      await expect.poll(() => worldPos(cardEl(peer.page, text))).toEqual(dropped);

      // Fit brings everything into view, whatever has happened to the view.
      await host.page.getByRole('button', { name: 'Fit' }).click();
      const port = await host.page.getByTestId('board-canvas').boundingBox();
      for (const el of await host.page.getByTestId('canvas-card').all()) {
        const box = await el.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(port!.x);
        expect(box!.y).toBeGreaterThanOrEqual(port!.y);
        expect(box!.x + box!.width).toBeLessThanOrEqual(port!.x + port!.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(port!.y + port!.height);
      }
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('dropping a card on a card overlaps it and never merges; the last moved is on top', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const suffix = Math.random().toString(36).slice(2, 6);
      const a = `Top ${suffix}`;
      const b = `Under ${suffix}`;
      await importBoard(page, canvasFile(`Stack ${suffix}`, { ok: [{ text: a }], well: [{ text: b }] }), 'Host');
      await expect(page.getByText(/Drag cards near each other/)).toBeVisible();
      await expect(page.getByText(/Drag a card onto another/)).toBeHidden();
      const elA = cardEl(page, a);
      const elB = cardEl(page, b);
      const [boxA, boxB] = [await elA.boundingBox(), await elB.boundingBox()];
      await drag(page, elA, boxB!.x - boxA!.x + 10, boxB!.y - boxA!.y + 10);
      await expect(page.getByTestId('canvas-card')).toHaveCount(2);
      await expect(elA).not.toContainText('— — —');
      const z = (el: Locator) => el.evaluate((n) => Number((n as HTMLElement).style.zIndex));
      await expect.poll(async () => (await z(elA)) > (await z(elB))).toBe(true);

      // Moving the other one puts that on top instead. Grab its left edge, the
      // part the top card doesn't cover.
      const under = await elB.boundingBox();
      await page.mouse.move(under!.x + 4, under!.y + under!.height / 2);
      await page.mouse.down();
      await page.mouse.move(under!.x + under!.width + 100, under!.y + under!.height + 60, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await z(elB)) > (await z(elA))).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('a card keeps its prompt color when moved next to another prompt', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const suffix = Math.random().toString(36).slice(2, 6);
      const text = `Colored ${suffix}`;
      await importBoard(page, canvasFile(`Color ${suffix}`, { ok: [{ text }], well: [{ text: `Other ${suffix}` }] }), 'Host');
      const el = cardEl(page, text);
      const classes = await el.getAttribute('class');
      expect(classes).toContain('amber');
      await expect(el).toHaveAttribute('data-column', 'ok');
      const other = await cardEl(page, `Other ${suffix}`).boundingBox();
      const box = await el.boundingBox();
      await drag(page, el, other!.x - box!.x + 30, other!.y - box!.y + 30);
      await expect(el).toHaveAttribute('data-column', 'ok');
      expect(await el.getAttribute('class')).toContain('amber');
      const file = await saveBoardFile(page);
      expect(file.cards.ok[0].text).toBe(text);
      expect(file.cards.well).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });

  test('clicks stay clicks: a tiny movement or a press on a button moves nothing', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const suffix = Math.random().toString(36).slice(2, 6);
      const text = `Steady ${suffix}`;
      await importBoard(page, canvasFile(`Click ${suffix}`, { ok: [{ text }] }, { phase: 'vote' }), 'Host');
      const el = cardEl(page, text);
      const start = await worldPos(el);

      const from = await center(el);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 2, from.y + 1);
      await page.mouse.up();
      expect(await worldPos(el)).toEqual(start);

      const vote = el.getByRole('button', { name: /vote/i });
      const box = await vote.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + 80, box!.y + 80, { steps: 3 });
      await page.mouse.up();
      expect(await worldPos(el)).toEqual(start);
      const file = await saveBoardFile(page);
      expect(file.cards.ok[0]).not.toHaveProperty('pos');
    } finally {
      await ctx.close();
    }
  });

  test('Shift + arrows nudge a focused card, and tabbing to an off-screen card pans instead of scrolling', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const suffix = Math.random().toString(36).slice(2, 6);
      const near = `Near ${suffix}`;
      const far = `Far away ${suffix}`;
      await importBoard(page, canvasFile(`Keys ${suffix}`, { ok: [{ text: near }], well: [{ text: far, pos: { x: 3000, y: 2000, z: 1 } }] }), 'Host');
      const el = cardEl(page, near);
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.getByRole('button', { name: 'Zoom in' }).click();
      const start = await worldPos(el);
      await el.getByRole('group', { name: `Card: ${near}` }).focus();
      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      await expect.poll(() => worldPos(el)).toEqual({ x: start!.x + 20, y: start!.y + 20 });

      const target = cardEl(page, far).getByRole('group', { name: `Card: ${far}` });
      await target.focus();
      const viewport = page.getByTestId('board-canvas');
      const scroll = await viewport.evaluate((n) => [n.scrollLeft, n.scrollTop]);
      expect(scroll).toEqual([0, 0]);
      const port = await viewport.boundingBox();
      const box = await target.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(port!.x);
      expect(box!.y).toBeGreaterThanOrEqual(port!.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(port!.x + port!.width);
    } finally {
      await ctx.close();
    }
  });

  test('hidden cards are placeholders where they sit, and can\'t be dragged', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const secret = `Secret ${suffix}`;
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      const file = canvasFile(`Hide ${suffix}`, { ok: [{ text: secret, authorId: 'someone-else', pos: { x: 500, y: 300, z: 1 } }] }, { phase: 'brainstorm', hideCards: true });
      await importBoard(host.page, file, 'Host');
      await expect(host.page.getByTestId('hidden-card')).toHaveCount(1);
      await expect(host.page.getByTestId('board-canvas')).not.toContainText(secret);

      const wrapper = host.page.getByTestId('canvas-card');
      const start = await worldPos(wrapper);
      expect(start).toEqual({ x: 500, y: 300 });
      const box = await wrapper.boundingBox();
      await host.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await host.page.mouse.down();
      await host.page.mouse.move(box!.x + 150, box!.y + 150, { steps: 4 });
      await host.page.mouse.up();
      expect(await worldPos(wrapper)).toEqual(start);

      // Moving to Group reveals it where it is.
      await host.page.getByRole('button', { name: 'Advance to Group phase' }).click();
      await expect(cardEl(host.page, secret)).toBeVisible();
      expect(await worldPos(cardEl(host.page, secret))).toEqual(start);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('an anonymous board shows no names while a card is dragged', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const hostName = `Hostname${suffix}`;
    const text = `Anon ${suffix}`;
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importBoard(host.page, canvasFile(`Anon ${suffix}`, { ok: [{ text }] }), hostName);
      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');
      await drag(host.page, cardEl(host.page, text), 150, 80, { release: false });
      await expect(cardEl(peer.page, text)).toHaveAttribute('data-live', '');
      await expect(peer.page.getByTestId('board-canvas')).not.toContainText(hostName);
      await host.page.mouse.up();
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('losing the dragger mid-drag leaves no ghost card', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const text = `Ghost ${suffix}`;
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importBoard(host.page, canvasFile(`Ghost ${suffix}`, { ok: [{ text }] }), 'Host');
      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');
      const onPeer = cardEl(peer.page, text);
      const start = await worldPos(onPeer);
      await drag(host.page, cardEl(host.page, text), 200, 100, { release: false });
      await expect(onPeer).toHaveAttribute('data-live', '');
      expect((await worldPos(onPeer))!.x).not.toBe(start!.x);

      // No goodbye: the tab is cut off, so the only signal is the frames stopping.
      await host.ctx.setOffline(true);
      await expect(onPeer).not.toHaveAttribute('data-live', '', { timeout: 5000 });
      expect(await worldPos(onPeer)).toEqual(start);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('an ended canvas is read-only but can still be panned, zoomed and exported', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const text = `Frozen ${suffix}`;
    const { ctx, page } = await newPage(browser);
    try {
      await importBoard(page, canvasFile(`Ended ${suffix}`, { ok: [{ text, pos: { x: 40, y: 200, z: 1 } }] }), 'Host');
      await page.getByRole('button', { name: 'End retro' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('board-canvas')).toBeVisible();

      const el = cardEl(page, text);
      const start = await worldPos(el);
      const view = await worldTransform(page);
      await drag(page, el, 100, 100);
      expect(await worldPos(el)).toEqual(start);
      // That press landed on a card that can't move, so it panned instead.
      expect(await worldTransform(page)).not.toBe(view);

      await page.getByRole('button', { name: 'Zoom out' }).click();
      const file = await saveBoardFile(page);
      expect(file.board.layout).toBe('canvas');
      expect(file.cards.ok[0].pos).toEqual({ x: 40, y: 200, z: 1 });
    } finally {
      await ctx.close();
    }
  });

  test('column boards are unaffected', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      await page.goto('/');
      const name = `plain-${Math.random().toString(36).slice(2, 6)}`;
      const res = await page.request.post('/api/boards', { data: { slug: name } });
      const slug = res.ok() ? ((await res.json()) as { slug: string }).slug : name;
      await page.goto(`/board/${slug}`);
      const nameInput = page.getByLabel('Your display name');
      await nameInput.fill('Plain');
      await page.getByRole('button', { name: 'Join the retro' }).click();
      await expect(page.getByTestId('board-columns')).toBeVisible();
      await expect(page.getByTestId('board-canvas')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
