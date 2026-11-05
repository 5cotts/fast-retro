import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Making and running a canvas board (frontend/src/lib/CanvasSurface.svelte and
 * friends): the Canvas choice, the composer, double-click, the Action items dock
 * and List view. Moving cards around is in canvas.spec.ts.
 */
const VIEWPORT = { width: 1400, height: 900 };
const PHONE = { width: 390, height: 780 };

async function newPage(browser: Browser, viewport = VIEWPORT) {
  const ctx = await browser.newContext({ viewport });
  return { ctx, page: await ctx.newPage() };
}

async function join(page: Page, name: string, ready = page.getByTestId('board-canvas')) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput.or(ready)).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await expect(ready).toBeVisible();
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(gotIt).toBeHidden();
}

async function openDialog(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  return page.getByRole('dialog', { name: 'Start a new retro' });
}

async function createCanvas(
  page: Page,
  label: string,
  prompts: string[],
  opts: { name?: string; actionItems?: boolean; hideCards?: boolean } = {}
) {
  const dialog = await openDialog(page);
  await dialog.getByLabel('Retro name').fill(label);
  await dialog.getByRole('radiogroup', { name: 'Board type' }).getByText('Canvas', { exact: true }).click();
  for (const [i, prompt] of prompts.entries()) {
    if (i > 0) await dialog.getByRole('button', { name: 'Add prompt' }).click();
    await dialog.getByLabel(`Prompt ${i + 1} name`).fill(prompt);
  }
  if (opts.actionItems === false) await dialog.getByLabel(/Action items panel/).uncheck();
  if (opts.hideCards) await dialog.getByLabel(/Hide others' cards/).check();
  await dialog.getByRole('button', { name: 'Create retro' }).click();
  await page.waitForURL(/\/board\//);
  await join(page, opts.name ?? 'Host');
}

async function importCanvas(page: Page, file: object, name = 'Host', ready?: Locator) {
  const dialog = await openDialog(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Import from file…' }).click()
  ]);
  await chooser.setFiles({ name: 'canvas.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  await join(page, name, ready ?? page.getByTestId('board-canvas'));
}

function canvasFile(label: string, cards: Record<string, { text: string; pos?: object }[]>, board: object = {}) {
  return {
    format: 'fast-retro',
    version: 4,
    exportedAt: 1,
    board: {
      label,
      anonymous: true,
      phase: 'brainstorm',
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

const cardEl = (page: Page, text: string) => page.getByTestId('canvas-card').filter({ hasText: text });
const headings = (page: Page) => page.getByTestId('canvas-heading');
const worldPos = (el: Locator) =>
  el.evaluate((node) => {
    const m = (node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });

async function compose(page: Page, prompt: string, text: string) {
  const composer = page.getByTestId('canvas-composer');
  await composer.getByRole('radiogroup', { name: 'Prompt' }).getByText(prompt, { exact: true }).click();
  await composer.getByRole('textbox').fill(text);
  await composer.getByRole('textbox').press('Enter');
}

async function nextPhase(page: Page, times = 1) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: /^Advance to / }).click();
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

const view = (page: Page, name: 'Canvas' | 'List') =>
  page.getByRole('group', { name: 'Board view' }).getByRole('button', { name, exact: true });

test.describe('making a canvas board', () => {
  test('from the dialog: the composer and a double-click both add cards, for everyone, and stay', async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await createCanvas(host.page, `Canvas ${s}`, ['Went OK', 'Went well']);
      await expect(headings(host.page)).toHaveText(['Went OK', 'Went well']);

      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');

      // The composer: under the chosen prompt's heading, in that prompt's color.
      await compose(peer.page, 'Went well', `Composed ${s}`);
      const composed = cardEl(host.page, `Composed ${s}`);
      await expect(composed).toBeVisible();
      await expect(composed).toHaveAttribute('data-color', 'amber');
      const headingBox = await headings(host.page).nth(1).boundingBox();
      const composedBox = await composed.boundingBox();
      expect(Math.abs(composedBox!.x - headingBox!.x)).toBeLessThan(2);
      expect(composedBox!.y).toBeGreaterThan(headingBox!.y);

      // A double-click: right there, under the selected prompt.
      const canvas = await host.page.getByTestId('board-canvas').boundingBox();
      const spot = { x: canvas!.x + canvas!.width - 200, y: canvas!.y + canvas!.height - 120 };
      await host.page.getByTestId('canvas-composer').getByRole('radiogroup', { name: 'Prompt' }).getByText('Went OK', { exact: true }).click();
      await host.page.mouse.dblclick(spot.x, spot.y);
      const draft = host.page.getByTestId('canvas-draft');
      await expect(draft).toHaveAttribute('data-column', /.+/);
      await expect(draft.getByRole('textbox')).toBeFocused();
      await draft.getByRole('textbox').fill(`Placed ${s}`);
      await draft.getByRole('textbox').press('Enter');
      await expect(draft).toBeHidden();
      const placed = cardEl(host.page, `Placed ${s}`);
      await expect(placed).toBeVisible();
      await expect(placed).toHaveAttribute('data-color', 'emerald');
      const placedBox = await placed.boundingBox();
      expect(Math.abs(placedBox!.x + placedBox!.width / 2 - spot.x)).toBeLessThan(40);
      expect(Math.abs(placedBox!.y - spot.y)).toBeLessThan(40);
      await expect(cardEl(peer.page, `Placed ${s}`)).toBeVisible();

      // Escape and an empty draft leave nothing behind.
      await host.page.mouse.dblclick(canvas!.x + 40, canvas!.y + canvas!.height - 60);
      await draft.getByRole('textbox').fill('Never mind');
      await draft.getByRole('textbox').press('Escape');
      await expect(draft).toBeHidden();
      await host.page.mouse.dblclick(canvas!.x + 40, canvas!.y + canvas!.height - 60);
      await expect(draft).toBeVisible();
      await host.page.mouse.click(canvas!.x + canvas!.width - 40, canvas!.y + 30);
      await expect(draft).toBeHidden();
      await expect(host.page.getByTestId('canvas-card')).toHaveCount(2);

      const file = await saveBoardFile(host.page);
      expect(file.board.layout).toBe('canvas');
      const byText = Object.values(file.cards).flat() as { text: string; pos?: unknown }[];
      expect(byText.find((c) => c.text === `Placed ${s}`)!.pos).toBeTruthy();
      expect(byText.find((c) => c.text === `Composed ${s}`)).not.toHaveProperty('pos');

      await peer.page.reload();
      await expect(cardEl(peer.page, `Placed ${s}`)).toBeVisible();
      await expect.poll(() => worldPos(cardEl(peer.page, `Placed ${s}`))).toEqual(await worldPos(placed));
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('with no prompts named it gets a Notes prompt, and the composer goes away after Brainstorm', async ({ browser }) => {
    test.setTimeout(60_000);
    const { ctx, page } = await newPage(browser);
    try {
      await createCanvas(page, `Notes ${Math.random().toString(36).slice(2, 6)}`, [], { actionItems: false });
      await expect(headings(page)).toHaveText(['Notes']);
      await expect(page.getByTestId('canvas-composer')).toBeVisible();
      await nextPhase(page);
      await expect(page.getByTestId('canvas-composer')).toBeHidden();
      // A double-click only places a card during Brainstorm.
      const canvas = await page.getByTestId('board-canvas').boundingBox();
      await page.mouse.dblclick(canvas!.x + canvas!.width - 100, canvas!.y + canvas!.height - 100);
      await expect(page.getByTestId('canvas-draft')).toBeHidden();
      // Without Action items the board ends at Discuss, and there's no dock.
      await expect(page.getByRole('button', { name: /Advance to Actions/ })).toHaveCount(0);
      await nextPhase(page, 2);
      await expect(page.getByTestId('canvas-dock')).toBeHidden();
    } finally {
      await ctx.close();
    }
  });

  test('the composer pans to its new card when that spot is off screen', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      const many = Array.from({ length: 8 }, (_, i) => ({ text: `Old ${i} ${s}` }));
      await importCanvas(page, canvasFile(`Pan ${s}`, { ok: many }));
      for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
      await compose(page, 'Went OK', `New ${s}`);
      const box = await cardEl(page, `New ${s}`).boundingBox();
      const canvas = await page.getByTestId('board-canvas').boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(canvas!.y);
      expect(box!.x).toBeGreaterThanOrEqual(canvas!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
    } finally {
      await ctx.close();
    }
  });

  test('a long card leaves room for the next one in its prompt', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      const long = `Long ${s} ` + 'this card goes on and on about flaky tests and who owns them '.repeat(6);
      await importCanvas(page, canvasFile(`Long ${s}`, { ok: [{ text: long }, { text: `Next ${s}` }] }));
      const longBox = await cardEl(page, `Long ${s}`).boundingBox();
      const nextBox = await cardEl(page, `Next ${s}`).boundingBox();
      expect(nextBox!.y).toBeGreaterThanOrEqual(longBox!.y + longBox!.height);
      // Fit counts it too.
      await page.getByRole('button', { name: 'Fit' }).click();
      const canvas = await page.getByTestId('board-canvas').boundingBox();
      const fitted = await cardEl(page, `Next ${s}`).boundingBox();
      expect(fitted!.y + fitted!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
    } finally {
      await ctx.close();
    }
  });

  test('the view re-fits when the canvas changes size, until someone moves it', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      const columns = [
        { key: 'a', title: 'First', color: 'amber' },
        { key: 'b', title: 'Second', color: 'emerald' },
        { key: 'c', title: 'Third', color: 'violet' },
        { key: 'd', title: 'Fourth', color: 'rose' },
        { key: 'actions', title: 'Action items', color: 'sky' }
      ];
      await importCanvas(page, canvasFile(`Fit ${s}`, { d: [{ text: `Far ${s}` }] }, { columns, phase: 'discuss' }));
      await expect(page.getByTestId('canvas-dock')).toBeHidden();

      // The dock opens: the last prompt must not end up underneath it.
      await nextPhase(page);
      await expect(page.getByTestId('canvas-dock')).toBeVisible();
      const canvas = await page.getByTestId('board-canvas').boundingBox();
      await expect
        .poll(async () => {
          const box = await cardEl(page, `Far ${s}`).boundingBox();
          return box!.x + box!.width;
        })
        .toBeLessThanOrEqual(canvas!.x + canvas!.width);

      // Once someone has zoomed, closing the dock leaves their view alone.
      await page.getByRole('button', { name: 'Zoom in' }).click();
      const zoom = await page.getByTestId('canvas-zoom').textContent();
      await page.getByRole('button', { name: /Go back to Discuss/ }).click();
      await expect(page.getByTestId('canvas-dock')).toBeHidden();
      await expect(page.getByTestId('canvas-zoom')).toHaveText(zoom!);
    } finally {
      await ctx.close();
    }
  });

  test('hide-cards: people write in private on a canvas, and Group reveals it all', async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await createCanvas(host.page, `Hide ${s}`, ['Ideas'], { hideCards: true });
      await expect(host.page.getByTestId('hidden-cards-banner')).toBeVisible();
      const peer = await newPage(browser);
      contexts.push(peer.ctx);
      await peer.page.goto(host.page.url());
      await join(peer.page, 'Peer');

      await compose(peer.page, 'Ideas', `Secret ${s}`);
      await expect(cardEl(peer.page, `Secret ${s}`)).toBeVisible();
      await expect(host.page.getByTestId('canvas-card')).toHaveCount(1);
      await expect(host.page.getByText(`Secret ${s}`)).toHaveCount(0);

      await nextPhase(host.page);
      await expect(cardEl(host.page, `Secret ${s}`)).toBeVisible();
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });
});

test.describe('running a canvas board', () => {
  test('Action items are docked beside the canvas, not on it, through the end and into the next retro', async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      await createCanvas(page, `Dock ${s}`, ['Ideas']);
      await expect(headings(page)).toHaveText(['Ideas']);
      await expect(page.getByTestId('canvas-dock')).toBeHidden();

      await nextPhase(page, 4);
      const dock = page.getByTestId('canvas-dock');
      await expect(dock).toBeVisible();
      await dock.getByRole('textbox').fill(`Ship it ${s}`);
      await dock.getByRole('textbox').press('Enter');
      await expect(dock.getByText(`Ship it ${s}`)).toBeVisible();
      await expect(page.getByTestId('canvas-card')).toHaveCount(0);

      // The dock doesn't cover the canvas: they sit side by side.
      const dockBox = await dock.boundingBox();
      const canvas = await page.getByTestId('board-canvas').boundingBox();
      expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(dockBox!.x + 1);

      await page.getByRole('button', { name: /End retro/ }).first().click();
      await page.getByRole('button', { name: 'Archive & end' }).click();
      await expect(page.getByText('This retro has ended')).toBeVisible();
      await expect(dock.getByText(`Ship it ${s}`)).toBeVisible();
      await expect(dock.getByRole('textbox')).toHaveCount(0);

      const endedUrl = page.url();
      await page.getByRole('button', { name: 'Start next retro' }).click();
      await page.waitForURL((url) => url.href !== endedUrl);
      await expect(page.getByText('This retro has ended')).toBeHidden();
      await expect(page.getByTestId('board-canvas')).toBeVisible();
      // Carried over: waiting in the dock from the start.
      await expect(page.getByTestId('canvas-dock').getByText(`Ship it ${s}`)).toBeVisible();
      await expect(page.getByTestId('canvas-card')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('List view shows the same cards with voting and no dragging, and leaves positions alone', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      const text = `Listed ${s}`;
      await importCanvas(page, canvasFile(`List ${s}`, { ok: [{ text, pos: { x: 900, y: 500, z: 2 } }], well: [{ text: `Other ${s}` }] }, { phase: 'vote' }));
      await expect(view(page, 'Canvas')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(/Vote on what to discuss/)).toBeVisible();

      await view(page, 'List').click();
      await expect(page.getByTestId('board-canvas')).toBeHidden();
      const columns = page.getByTestId('board-columns');
      await expect(columns.getByRole('list', { name: 'Went OK' }).getByText(text)).toBeVisible();
      await expect(columns.getByRole('list', { name: 'Went well' }).getByText(`Other ${s}`)).toBeVisible();

      // Voting works here, and nothing can be dragged.
      const card = columns.getByRole('list', { name: 'Went OK' }).getByRole('listitem').filter({ hasText: text });
      await card.getByRole('button', { name: /vote/i }).first().click();
      await expect(card.locator('[draggable="true"]')).toHaveCount(0);

      await view(page, 'Canvas').click();
      await expect(page.getByTestId('board-canvas')).toBeVisible();
      await expect.poll(() => worldPos(cardEl(page, text))).toEqual({ x: 900, y: 500 });

      const file = await saveBoardFile(page);
      expect(file.cards.ok[0].votes.length).toBe(1);
      expect(file.cards.ok[0].pos).toMatchObject({ x: 900, y: 500 });
    } finally {
      await ctx.close();
    }
  });

  test('List view lets people add cards in Brainstorm, and hints at the canvas in Group', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      await createCanvas(page, `List add ${s}`, ['Ideas']);
      await view(page, 'List').click();
      const column = page.getByRole('list', { name: 'Ideas' });
      await column.getByRole('textbox').fill(`From the list ${s}`);
      await column.getByRole('textbox').press('Enter');
      await expect(column.getByText(`From the list ${s}`)).toBeVisible();
      await nextPhase(page);
      await expect(page.getByText(/Switch to Canvas/)).toBeVisible();
      await view(page, 'Canvas').click();
      await expect(page.getByText(/Drag cards near each other/)).toBeVisible();
      await expect(cardEl(page, `From the list ${s}`)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('a phone starts in List view, and can open the canvas', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const contexts = [];
    try {
      const host = await newPage(browser);
      contexts.push(host.ctx);
      await importCanvas(host.page, canvasFile(`Phone ${s}`, { ok: [{ text: `Card ${s}` }] }, { phase: 'group' }));
      const phone = await newPage(browser, PHONE);
      contexts.push(phone.ctx);
      await phone.page.goto(host.page.url());
      await join(phone.page, 'Phone', phone.page.getByTestId('board-columns'));
      await expect(phone.page.getByTestId('board-canvas')).toBeHidden();
      await expect(phone.page.getByText(`Card ${s}`)).toBeVisible();

      await view(phone.page, 'Canvas').click();
      await expect(phone.page.getByTestId('board-canvas')).toBeVisible();
      await expect(cardEl(phone.page, `Card ${s}`)).toBeVisible();
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });

  test('a host edits prompts, not columns: no auto-sort, inline rename, and cards keep their place in Discuss', async ({ browser }) => {
    test.setTimeout(60_000);
    const s = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      await importCanvas(page, canvasFile(`Edit ${s}`, { ok: [{ text: `Low ${s}` }, { text: `High ${s}`, votes: ['a', 'b'] } as { text: string }] }, { phase: 'vote' }));
      const low = await worldPos(cardEl(page, `Low ${s}`));
      const high = await worldPos(cardEl(page, `High ${s}`));
      await nextPhase(page);
      await expect(page.getByRole('button', { name: /auto-sort/i })).toHaveCount(0);
      // Discuss doesn't re-sort a canvas, however the votes fell.
      expect(await worldPos(cardEl(page, `Low ${s}`))).toEqual(low);
      expect(await worldPos(cardEl(page, `High ${s}`))).toEqual(high);

      await headings(page).first().getByRole('button', { name: 'Went OK' }).click();
      const rename = page.getByLabel('Prompt name');
      await rename.fill(`Renamed ${s}`);
      await rename.press('Enter');
      await expect(headings(page).first()).toHaveText(`Renamed ${s}`);

      await page.getByRole('button', { name: /Edit board/ }).first().click();
      const dialog = page.getByRole('dialog', { name: /Edit board/ });
      await expect(dialog.getByText('Prompts', { exact: true })).toBeVisible();
      await expect(dialog.getByLabel('Prompt 1 name')).toHaveValue(`Renamed ${s}`);
      await expect(dialog.getByText(/Auto-sort/)).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Add prompt' }).click();
      await dialog.getByLabel('Prompt 3 name').fill(`Third ${s}`);
      await dialog.getByRole('button', { name: /^Save/ }).click();
      await expect(headings(page)).toHaveCount(3);
    } finally {
      await ctx.close();
    }
  });
});
