import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Groups on a canvas board: a box that holds its cards, made by dropping a card
 * on a card in the Group phase. Each board comes from importing a v4 file, so
 * positions are exact. A card or box's style.transform is its world position,
 * the same for everyone whatever their pan and zoom.
 */
const VIEWPORT = { width: 1400, height: 900 };

interface SeedCard {
  text: string;
  clusterId?: string;
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

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
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

async function importBoard(page: Page, file: object, name = 'Host') {
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

async function withPeer(browser: Browser, host: Page, name = 'Peer') {
  const peer = await newPage(browser);
  await peer.page.goto(host.url());
  await join(peer.page, name);
  return peer;
}

const cardEl = (page: Page, text: string) => page.getByTestId('canvas-card').filter({ hasText: text });
const groups = (page: Page) => page.getByTestId('canvas-group');
const worldPos = (el: Locator) =>
  el.evaluate((node) => {
    const m = (node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });

// The top line of a card, away from its buttons.
async function grab(el: Locator) {
  const box = await el.boundingBox();
  if (!box) throw new Error('not on screen');
  return { x: box.x + box.width / 2, y: box.y + 14 };
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { release?: boolean } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  if (opts.release !== false) await page.mouse.up();
}

// The padding and grip at the top of a box, which move the box.
async function boxHandle(group: Locator) {
  const box = await group.boundingBox();
  if (!box) throw new Error('not on screen');
  return { x: box.x + 10, y: box.y + 10 };
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

const suffix = () => Math.random().toString(36).slice(2, 6);
const spread = (n: number) => ({ x: 40 + (n % 3) * 330, y: 80 + Math.floor(n / 3) * 260, z: n + 1 });

test.describe('fast-retro canvas groups', () => {
  test('drop on a card makes a group, drop on a group joins, drag out leaves; everyone sees it', async ({ browser }) => {
    test.setTimeout(120_000);
    const s = suffix();
    const [a, b, c] = [`Alpha ${s}`, `Bravo ${s}`, `Charlie ${s}`];
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importBoard(
        host.page,
        canvasFile(`Groups ${s}`, { ok: [{ text: a, pos: spread(0) }, { text: b, pos: spread(1) }], well: [{ text: c, pos: { x: 700, y: 560, z: 3 } }] }),
        'Host'
      );
      const peer = await withPeer(browser, host.page);
      contexts.push(peer.ctx);
      await expect(groups(host.page)).toHaveCount(0);

      // The target lights up before the drop, and nothing is written yet.
      const elA = cardEl(host.page, a);
      const elB = cardEl(host.page, b);
      await dragTo(host.page, await grab(elA), await grab(elB), { release: false });
      await expect(elB.locator('.card')).toHaveClass(/border-violet-400/);
      await expect(groups(host.page)).toHaveCount(0);
      await host.page.mouse.up();

      for (const page of [host.page, peer.page]) {
        await expect(groups(page)).toHaveCount(1);
        await expect(groups(page).getByTestId('canvas-card')).toHaveCount(2);
        await expect(groups(page)).toContainText('2 cards');
      }
      // Both cards are inside the box, so neither is a loose card any more.
      expect(await groups(host.page).getByTestId('canvas-card').filter({ hasText: a }).count()).toBe(1);

      // A card of another prompt joins by dropping on the box. It keeps its color.
      const box = groups(host.page).first();
      await dragTo(host.page, await grab(cardEl(host.page, c)), await boxHandle(box).then((p) => ({ x: p.x + 60, y: p.y + 60 })), { release: false });
      await expect(box).toHaveAttribute('data-drop-target', '');
      await host.page.mouse.up();
      for (const page of [host.page, peer.page]) {
        await expect(groups(page).getByTestId('canvas-card')).toHaveCount(3);
        await expect(groups(page)).toContainText('3 cards');
      }
      await expect(cardEl(peer.page, c)).toHaveAttribute('data-column', 'well');

      // Dragging a card out of the box leaves the group, where it was dropped.
      const inside = groups(host.page).getByTestId('canvas-card').filter({ hasText: c });
      await dragTo(host.page, await grab(inside), { x: 1250, y: 700 });
      for (const page of [host.page, peer.page]) {
        await expect(groups(page).getByTestId('canvas-card')).toHaveCount(2);
        await expect(groups(page)).toContainText('2 cards');
      }
      const left = await worldPos(cardEl(peer.page, c));
      expect(left!.x).toBeGreaterThan(600);
      await expect.poll(() => worldPos(cardEl(host.page, c))).toEqual(left);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('dragging a box moves it live for the other person, saves on drop and survives a reload', async ({ browser }) => {
    test.setTimeout(120_000);
    const s = suffix();
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importBoard(
        host.page,
        canvasFile(
          `Move ${s}`,
          { ok: [{ text: `One ${s}`, clusterId: 'g', pos: spread(0) }, { text: `Two ${s}`, clusterId: 'g', pos: spread(1) }] },
          { clusters: [{ id: 'g', label: `Theme ${s}`, pos: { x: 200, y: 150, z: 5 } }] }
        ),
        'Host'
      );
      const peer = await withPeer(browser, host.page);
      contexts.push(peer.ctx);
      const onHost = groups(host.page).first();
      const onPeer = groups(peer.page).first();
      await expect(onPeer).toContainText(`Theme ${s}`);
      const start = await worldPos(onHost);
      expect(start).toEqual({ x: 200, y: 150 });
      expect(await worldPos(onPeer)).toEqual(start);

      await dragTo(host.page, await boxHandle(onHost), { ...(await boxHandle(onHost)), x: (await boxHandle(onHost)).x + 220, y: (await boxHandle(onHost)).y + 90 }, { release: false });
      await expect.poll(async () => (await worldPos(onPeer))!.x).toBeGreaterThan(start!.x + 50);
      await expect(onPeer).toHaveAttribute('data-live', '');
      await host.page.mouse.up();
      await expect(onPeer).not.toHaveAttribute('data-live', '');
      const dropped = await worldPos(onHost);
      expect(dropped!.x).toBeGreaterThan(start!.x + 150);
      await expect.poll(() => worldPos(onPeer)).toEqual(dropped);

      await peer.page.reload();
      await expect(groups(peer.page).first()).toBeVisible();
      await expect.poll(() => worldPos(groups(peer.page).first())).toEqual(dropped);

      const file = await saveBoardFile(host.page);
      expect(file.board.clusters).toHaveLength(1);
      expect(file.board.clusters[0].pos.x).toBeCloseTo(dropped!.x, 3);
      expect(file.board.clusters[0].label).toBe(`Theme ${s}`);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('outside Group, a card in a box stays put and a drop on a box only overlaps it', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const s = suffix();
      await importBoard(
        page,
        canvasFile(
          `Vote ${s}`,
          { ok: [{ text: `In ${s}`, clusterId: 'g', pos: spread(0) }, { text: `Also ${s}`, clusterId: 'g', pos: spread(1) }, { text: `Loose ${s}`, pos: spread(5) }] },
          { phase: 'vote', clusters: [{ id: 'g', label: 'Fixed', pos: { x: 100, y: 100, z: 1 } }] }
        ),
        'Host'
      );
      const box = groups(page).first();
      const before = await worldPos(box);
      // Pressing a card in the box now moves the box, not the card.
      await dragTo(page, await grab(cardEl(page, `In ${s}`)), { x: 900, y: 700 });
      await expect(groups(page).getByTestId('canvas-card')).toHaveCount(2);
      expect(await worldPos(box)).not.toEqual(before);
      // A loose card dropped on the box doesn't join it.
      const loose = cardEl(page, `Loose ${s}`);
      const target = await box.boundingBox();
      await dragTo(page, await grab(loose), { x: target!.x + 60, y: target!.y + 80 });
      await expect(groups(page).getByTestId('canvas-card')).toHaveCount(2);
      await expect(page.getByTestId('canvas-card')).toHaveCount(3);
      await expect(page.getByRole('button', { name: 'Ungroup Fixed' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('the Group menu joins, starts a new group and leaves, without dragging', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const s = suffix();
      await importBoard(
        page,
        canvasFile(
          `Menu ${s}`,
          {
            ok: [
              { text: `Boxed ${s}`, clusterId: 'g', pos: spread(0) },
              { text: `Boxed too ${s}`, clusterId: 'g', pos: spread(1) },
              { text: `Solo ${s}`, pos: spread(5) }
            ]
          },
          { clusters: [{ id: 'g', label: 'Named', pos: { x: 100, y: 100, z: 1 } }] }
        ),
        'Host'
      );
      // Join.
      await cardEl(page, `Solo ${s}`).getByRole('button', { name: 'Group this card' }).click();
      await page.getByRole('menuitem', { name: 'Named' }).click();
      await expect(groups(page).getByTestId('canvas-card')).toHaveCount(3);

      // Leave: lands beside the box, outside it, and covers nothing.
      await groups(page).getByTestId('canvas-card').filter({ hasText: `Solo ${s}` }).getByRole('button', { name: 'Group this card' }).click();
      await page.getByRole('menuitem', { name: 'Remove from group' }).click();
      await expect(groups(page).getByTestId('canvas-card')).toHaveCount(2);
      const boxRect = await groups(page).first().boundingBox();
      const soloRect = await cardEl(page, `Solo ${s}`).boundingBox();
      expect(soloRect!.x).toBeGreaterThanOrEqual(boxRect!.x + boxRect!.width);

      // New group: it opens where the card is, with its name.
      await cardEl(page, `Solo ${s}`).getByRole('button', { name: 'Group this card' }).click();
      await page.getByRole('menuitem', { name: 'New group…' }).click();
      await page.getByLabel('New group name').fill('Fresh');
      await page.getByRole('button', { name: 'Create' }).click();
      await expect(groups(page)).toHaveCount(2);
      await expect(groups(page).filter({ hasText: 'Fresh' }).getByTestId('canvas-card')).toHaveCount(1);
    } finally {
      await ctx.close();
    }
  });

  test('rename, ungroup (cards stay where drawn) and merge (host, one card at the corner)', async ({ browser }) => {
    test.setTimeout(90_000);
    const { ctx, page } = await newPage(browser);
    try {
      const s = suffix();
      const file = () =>
        canvasFile(
          `Actions ${s}`,
          { ok: [{ text: `P ${s}`, clusterId: 'g', pos: spread(0) }, { text: `Q ${s}`, clusterId: 'g', pos: spread(1) }] },
          { clusters: [{ id: 'g', label: 'Old name', pos: { x: 150, y: 120, z: 1 } }] }
        );
      await importBoard(page, file(), 'Host');
      await page.getByRole('heading', { name: 'Old name' }).click();
      await page.getByLabel('Group name').fill('New name');
      await page.getByLabel('Group name').press('Enter');
      await expect(groups(page)).toContainText('New name');

      // Ungroup: every card ends up exactly where it was drawn in the box.
      const drawn = await Promise.all(
        ['P', 'Q'].map(async (t) => {
          const box = await cardEl(page, `${t} ${s}`).boundingBox();
          return { x: Math.round(box!.x), y: Math.round(box!.y) };
        })
      );
      await page.getByRole('button', { name: /Ungroup/ }).click();
      await expect(groups(page)).toHaveCount(0);
      const after = await Promise.all(
        ['P', 'Q'].map(async (t) => {
          const box = await cardEl(page, `${t} ${s}`).boundingBox();
          return { x: Math.round(box!.x), y: Math.round(box!.y) };
        })
      );
      expect(after).toEqual(drawn);

      // Merge, on a second board.
      await importBoard(page, file(), 'Host');
      const corner = await worldPos(groups(page).first());
      await page.getByRole('button', { name: /Merge/ }).click();
      await page.getByRole('button', { name: 'Merge cards' }).click();
      await expect(groups(page)).toHaveCount(0);
      await expect(page.getByTestId('canvas-card')).toHaveCount(1);
      expect(await worldPos(page.getByTestId('canvas-card').first())).toEqual(corner);
    } finally {
      await ctx.close();
    }
  });

  test('a box keeps its name hidden in Brainstorm, and Shift+arrows nudge it', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const s = suffix();
      await importBoard(
        page,
        canvasFile(
          `Brain ${s}`,
          { ok: [{ text: `X ${s}`, clusterId: 'g', pos: spread(0) }, { text: `Y ${s}`, clusterId: 'g', pos: spread(1) }] },
          { phase: 'brainstorm', clusters: [{ id: 'g', label: 'Secret theme', pos: { x: 120, y: 90, z: 1 } }] }
        ),
        'Host'
      );
      // The box stays, so the cards don't jump back to where they sat before.
      await expect(groups(page)).toHaveCount(1);
      await expect(groups(page)).toContainText('Group');
      await expect(page.getByText('Secret theme')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Ungroup/ })).toHaveCount(0);

      const before = await worldPos(groups(page).first());
      await cardEl(page, `X ${s}`).getByRole('group', { name: `Card: X ${s}` }).focus();
      await page.keyboard.press('Shift+ArrowRight');
      await expect.poll(async () => (await worldPos(groups(page).first()))!.x).toBe(before!.x + 20);
    } finally {
      await ctx.close();
    }
  });

  test('hide-cards: a box shows its card count but never the text of hidden cards', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const s = suffix();
      await importBoard(
        page,
        canvasFile(
          `Hidden ${s}`,
          { ok: [{ text: `Secret one ${s}`, clusterId: 'g', pos: spread(0) }, { text: `Secret two ${s}`, clusterId: 'g', pos: spread(1) }] },
          { phase: 'brainstorm', hideCards: true, clusters: [{ id: 'g', label: 'Hidden theme', pos: { x: 120, y: 90, z: 1 } }] }
        ),
        'Host'
      );
      await expect(groups(page)).toHaveCount(1);
      await expect(groups(page)).toContainText('2 cards');
      await expect(groups(page).getByTestId('canvas-card')).toHaveCount(2);
      await expect(page.getByText(`Secret one ${s}`)).toHaveCount(0);
      await expect(page.getByText('Hidden theme')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('a group made on a column board opens on a canvas where its first card is, and Fit shows it', async ({ browser }) => {
    const { ctx, page } = await newPage(browser);
    try {
      const s = suffix();
      await importBoard(
        page,
        canvasFile(
          `Unplaced ${s}`,
          {
            ok: [{ text: `U ${s}`, clusterId: 'g', pos: { x: 600, y: 400, z: 1 } }, { text: `V ${s}`, clusterId: 'g', pos: spread(1) }]
          },
          { clusters: [{ id: 'g', label: 'Imported' }] }
        ),
        'Host'
      );
      await expect(groups(page)).toHaveCount(1);
      expect(await worldPos(groups(page).first())).toEqual({ x: 600, y: 400 });
      await page.getByRole('button', { name: 'Fit' }).click();
      const port = await page.getByTestId('board-canvas').boundingBox();
      const box = await groups(page).first().boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(port!.x);
      expect(box!.y).toBeGreaterThanOrEqual(port!.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(port!.x + port!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(port!.y + port!.height);
    } finally {
      await ctx.close();
    }
  });
});
