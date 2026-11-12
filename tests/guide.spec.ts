import { test, expect, type Page } from '@playwright/test';
import { GUIDE_PAGES } from '../frontend/src/lib/guide/pages';

/**
 * The user guide at /docs. Pages come from frontend/src/lib/guide/pages.ts, so
 * a page added there is covered here without touching this file.
 */
type GaCall = [string, Record<string, unknown>];

// The GA tag is stripped when no measurement ID is set, so tests stand in a
// gtag that records what the app sends.
async function recordAnalytics(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __ga: unknown[]; gtag: (type: string, name: string, params: unknown) => void };
    w.__ga = [];
    w.gtag = (type, name, params) => {
      if (type === 'event') w.__ga.push([name, params]);
    };
  });
}
const analytics = (page: Page) => page.evaluate(() => (window as unknown as { __ga: GaCall[] }).__ga);

// Console errors and CSP violations both fail the test that collected them.
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

test.describe('user guide', () => {
  test('every page loads from a direct link, with its title and audience', async ({ page }) => {
    const problems = collectProblems(page);
    for (const p of GUIDE_PAGES) {
      await page.goto(`/docs/${p.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
      await expect(page.getByText(`For: ${p.audience.toLowerCase()}`)).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(p.title));
    }
    expect(problems).toEqual([]);
  });

  test('the landing page has a card for every page, and each card opens it', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1, name: 'User guide' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(GUIDE_PAGES.length);
    for (const p of GUIDE_PAGES) {
      await page.goto('/docs');
      await page.getByRole('main').getByRole('link', { name: new RegExp(p.title) }).click();
      await expect(page).toHaveURL(new RegExp(`/docs/${p.slug}$`));
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
    }
  });

  test('the sidebar marks the current page, and previous/next walk the list in order', async ({ page }) => {
    await page.goto(`/docs/${GUIDE_PAGES[0].slug}`);
    const sidebar = page.getByRole('navigation', { name: 'User guide pages' });
    const footer = page.getByRole('navigation', { name: 'Previous and next pages' });
    await expect(sidebar.getByRole('link', { name: GUIDE_PAGES[0].title })).toHaveAttribute('aria-current', 'page');

    for (const p of GUIDE_PAGES.slice(1)) {
      await footer.getByRole('link', { name: p.title }).click();
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
      await expect(sidebar.getByRole('link', { name: p.title })).toHaveAttribute('aria-current', 'page');
    }
    await expect(footer.locator('a[rel="next"]')).toHaveCount(0);

    await footer.locator('a[rel="prev"]').click();
    await expect(page.getByRole('heading', { level: 1, name: GUIDE_PAGES.at(-2)!.title })).toBeVisible();
  });

  test('links inside the pages all lead somewhere real', async ({ page }) => {
    const slugs = new Set(GUIDE_PAGES.map((p) => `/docs/${p.slug}`));
    const anchors = new Set<string>();
    for (const p of GUIDE_PAGES) {
      await page.goto(`/docs/${p.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
      const hrefs = await page.locator('article a').evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
      for (const href of hrefs) {
        const [path, anchor] = href.split('#');
        expect(slugs, `${p.slug} links to ${href}`).toContain(path);
        if (anchor) anchors.add(href);
      }
    }
    // A link to a section needs that section to exist.
    for (const href of anchors) {
      await page.goto(href);
      await expect(page.locator(`article [id="${href.split('#')[1]}"]`), `${href} has no such section`).toHaveCount(1);
    }
  });

  test('the old role links redirect to the matching page', async ({ page }) => {
    await page.goto('/docs?role=lead');
    await expect(page).toHaveURL(/\/docs\/run$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Run your first retro' })).toBeVisible();

    await page.goto('/docs?role=participant');
    await expect(page).toHaveURL(/\/docs\/join$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Join a retro' })).toBeVisible();
  });

  test('a phone gets a menu in place of the sidebar', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto('/docs/join');
      const nav = page.getByRole('navigation', { name: 'User guide pages' });
      await expect(nav).toBeHidden();
      await page.getByRole('button', { name: 'Guide pages' }).click();
      await nav.getByRole('link', { name: 'Use a canvas board' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Use a canvas board' })).toBeVisible();
      await expect(nav).toBeHidden();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await ctx.close();
    }
  });

  test('a page opened directly follows the dark theme, and a saved light theme wins', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    try {
      const page = await ctx.newPage();
      await page.goto('/docs/setup');
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.evaluate(() => localStorage.setItem('retro-theme', 'light'));
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Set up and change a board' })).toBeVisible();
      await expect(page.locator('html')).not.toHaveClass(/dark/);
    } finally {
      await ctx.close();
    }
  });

  test('the board footer opens the page for your role', async ({ browser }) => {
    const host = await browser.newContext();
    const guest = await browser.newContext();
    try {
      const page = await host.newPage();
      await page.addInitScript(() => localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])));
      await page.goto('/');
      await page.getByRole('button', { name: 'Start a new retro' }).click();
      await page.getByRole('dialog', { name: 'Start a new retro' }).getByRole('button', { name: 'Create retro' }).click();
      await page.waitForURL(/\/board\//);
      const boardUrl = page.url();
      await page.getByLabel('Your display name').fill('Host');
      await page.getByRole('button', { name: 'Join the retro' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
      await page.getByRole('link', { name: 'User guide' }).click();
      await expect(page).toHaveURL(/\/docs\/run$/);

      const other = await guest.newPage();
      await other.goto(boardUrl);
      await other.getByLabel('Your display name').fill('Guest');
      await other.getByRole('button', { name: 'Join the retro' }).click();
      await expect(other.getByRole('link', { name: 'Read the full guide' })).toHaveAttribute('href', '/docs/join');
      await other.getByRole('button', { name: 'Got it' }).click();
      await other.getByRole('link', { name: 'User guide' }).click();
      await expect(other).toHaveURL(/\/docs\/join$/);
    } finally {
      await host.close();
      await guest.close();
    }
  });

  test('every clip decodes as served, with no console or CSP errors', async ({ page }) => {
    const problems = collectProblems(page);
    let total = 0;
    for (const p of GUIDE_PAGES) {
      await page.goto(`/docs/${p.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
      const clips = page.getByTestId('guide-clip').locator('img');
      for (let i = 0; i < (await clips.count()); i++) {
        const img = clips.nth(i);
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { message: `${p.slug} clip ${i}` }).toBeGreaterThan(0);
        expect((await img.getAttribute('alt'))?.length).toBeGreaterThan(20);
        total++;
      }
    }
    expect(total).toBe(10);
    expect(problems).toEqual([]);
  });

  test('a clip pauses to its still poster and plays again, by keyboard', async ({ page }) => {
    await page.goto('/docs/canvas');
    const clip = page.getByTestId('guide-clip').first();
    const img = clip.locator('img');
    const playing = await img.getAttribute('src');
    await clip.scrollIntoViewIfNeeded();

    await clip.getByRole('button', { name: 'Pause clip' }).focus();
    await page.keyboard.press('Enter');
    await expect(clip.getByRole('button', { name: 'Play clip' })).toBeFocused();
    await expect(img).not.toHaveAttribute('src', playing!);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    await page.keyboard.press('Space');
    await expect(img).toHaveAttribute('src', playing!);
  });

  test('with reduced motion, clips start on the poster with a Play button', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    try {
      const page = await ctx.newPage();
      await page.goto('/docs/canvas');
      const clip = page.getByTestId('guide-clip').first();
      await expect(clip.getByRole('button', { name: 'Play clip' })).toBeVisible();
      await expect(clip.locator('img')).toHaveAttribute('src', /poster/);
    } finally {
      await ctx.close();
    }
  });

  test('How to use opens the right page in a new tab, on canvas and custom boards only', async ({ browser }) => {
    const host = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const guest = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      const page = await host.newPage();
      await recordAnalytics(page);
      await page.addInitScript(() => localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])));
      const howToUse = (p: Page) => p.getByRole('link', { name: 'How to use' });
      const newBoard = async (template: 'Retro' | 'Custom' | 'Canvas') => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Start a new retro' }).click();
        const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
        await dialog.getByRole('radiogroup', { name: 'Board type' }).locator('label', { hasText: template }).click();
        if (template === 'Custom') await dialog.getByLabel('Column 1 name').fill('Problem one');
        await dialog.getByRole('button', { name: 'Create retro' }).click();
        await page.waitForURL(/\/board\//);
        const name = page.getByLabel('Your display name');
        const gotIt = page.getByRole('button', { name: 'Got it' });
        await expect(name.or(gotIt).or(page.getByRole('list', { name: 'Phases' })).first()).toBeVisible();
        if (await name.isVisible()) {
          await name.fill('Host');
          await page.getByRole('button', { name: 'Join the retro' }).click();
        }
        await expect(page.getByRole('list', { name: 'Phases' })).toBeVisible();
        await page.waitForTimeout(300);
        if (await gotIt.isVisible()) await gotIt.click();
      };

      await newBoard('Retro');
      await expect(howToUse(page)).toHaveCount(0);

      await newBoard('Canvas');
      await expect(howToUse(page)).toHaveAttribute('href', '/docs/canvas');
      await expect(howToUse(page)).toHaveAttribute('target', '_blank');
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await expect(howToUse(page)).toHaveAttribute('href', '/docs/canvas');

      await newBoard('Custom');
      await expect(howToUse(page)).toHaveAttribute('href', '/docs/setup');
      const [opened] = await Promise.all([page.context().waitForEvent('page'), howToUse(page).click()]);
      await expect(opened.getByRole('heading', { level: 1, name: 'Set up and change a board' })).toBeVisible();
      await opened.close();
      expect((await analytics(page)).filter(([name]) => name === 'guide_open').map(([, params]) => params)).toEqual([{ from: 'board_link' }]);

      const other = await guest.newPage();
      await other.goto(page.url());
      await other.getByLabel('Your display name').fill('Guest');
      await other.getByRole('button', { name: 'Join the retro' }).click();
      await expect(howToUse(other)).toHaveAttribute('href', '/docs/join');
    } finally {
      await host.close();
      await guest.close();
    }
  });

  test('How to use stays on screen on a phone', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      const page = await ctx.newPage();
      await page.addInitScript(() => localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])));
      await page.goto('/');
      await page.getByRole('button', { name: 'Start a new retro' }).click();
      const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
      await dialog.getByRole('radiogroup', { name: 'Board type' }).locator('label', { hasText: 'Canvas' }).click();
      await dialog.getByRole('button', { name: 'Create retro' }).click();
      await page.waitForURL(/\/board\//);
      await page.getByLabel('Your display name').fill('Host');
      await page.getByRole('button', { name: 'Join the retro' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();
      const box = await page.getByRole('link', { name: 'How to use' }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    } finally {
      await ctx.close();
    }
  });

  test('guide_view reports each page once, using fixed names', async ({ page }) => {
    await recordAnalytics(page);
    await page.goto('/docs');
    await page.getByRole('main').getByRole('link', { name: /Use a canvas board/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Use a canvas board' })).toBeVisible();
    const views = (await analytics(page)).filter(([name]) => name === 'guide_view').map(([, params]) => params);
    expect(views).toEqual([{ page: 'home' }, { page: 'canvas' }]);
  });

  test('canvas_drop says whether a dropped card landed on another card', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      const page = await ctx.newPage();
      await recordAnalytics(page);
      await page.addInitScript(() => localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])));
      await page.goto('/');
      await page.getByRole('button', { name: 'Start a new retro' }).click();
      const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        dialog.getByRole('button', { name: 'Import from file…' }).click()
      ]);
      const card = (text: string, x: number, y: number) => ({
        id: text,
        text,
        authorId: '',
        votes: [],
        reactions: {},
        comments: [],
        pos: { x, y, z: 1 }
      });
      const file = {
        format: 'fast-retro',
        version: 4,
        exportedAt: 1,
        board: {
          label: 'Drops',
          anonymous: true,
          phase: 'group',
          autoSort: true,
          columns: [{ key: 'ok', title: 'Notes', color: 'amber' }],
          layout: 'canvas'
        },
        cards: { ok: [card('Mover', 0, 0), card('Target', 600, 0)] }
      };
      await chooser.setFiles({ name: 'drops.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await dialog.getByRole('button', { name: 'Import retro' }).click();
      await page.waitForURL(/\/board\//);
      await page.getByLabel('Your display name').fill('Host');
      await page.getByRole('button', { name: 'Join the retro' }).click();
      await page.getByRole('button', { name: 'Got it' }).click();

      const mover = page.getByTestId('canvas-card').filter({ hasText: 'Mover' });
      const target = page.getByTestId('canvas-card').filter({ hasText: 'Target' });
      const dropOn = async (to: { x: number; y: number }) => {
        const from = (await mover.boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + 14);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.mouse.up();
      };
      const drops = async () => (await analytics(page)).filter(([name]) => name === 'canvas_drop').map(([, params]) => params);

      const before = (await mover.boundingBox())!;
      await dropOn({ x: before.x + before.width / 2, y: before.y + 300 });
      await expect.poll(drops).toEqual([{ on_card: false }]);

      const onto = (await target.boundingBox())!;
      await dropOn({ x: onto.x + onto.width / 2, y: onto.y + 14 });
      await expect.poll(drops).toEqual([{ on_card: false }, { on_card: true }]);
    } finally {
      await ctx.close();
    }
  });
});
