import { test, expect, type Page } from '@playwright/test';

/**
 * The "Report a bug" and "Request a feature" links (frontend/src/lib/FeedbackLink.svelte, FEEDBACK_URL).
 * test-local.sh sets FEEDBACK_URL=https://example.com/issues/new.
 * Plan: docs/feedback-intake-investigation.md, option D.
 *
 * The links open a public page from inside a board, so what matters most is
 * what leaves with them: no referrer, and nothing from the board in the URL.
 * Each one goes straight to its issue form with the form's fields prefilled,
 * so the reporter never copies anything across.
 */

const FEEDBACK = 'https://example.com/issues/new';

// Nothing here may leave the machine: example.com is answered locally.
async function stubFeedbackSite(page: Page) {
  const seen: Array<{ url: string; referer: string | undefined }> = [];
  await page.context().route('https://example.com/**', async (route) => {
    const req = route.request();
    seen.push({ url: req.url(), referer: req.headers()['referer'] });
    await route.fulfill({ contentType: 'text/html', body: '<title>feedback</title>' });
  });
  return seen;
}

async function createBoard(page: Page, label: string) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  await dialog.getByLabel('Retro name').fill(label);
  await dialog.getByRole('button', { name: 'Create retro' }).click();
  await page.waitForURL(/\/board\//);
  const nameInput = page.getByLabel('Your display name');
  const prompted = await nameInput.waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (prompted) {
    await nameInput.fill('Tester');
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  await expect(page.getByTestId('board-columns')).toBeVisible();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(gotIt).toBeHidden();
}

const BUG = 'Report a bug';
const FEATURE = 'Request a feature';
const REF = /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/;

test.describe('feedback links', () => {
  test('are on the home page and open the bug and feature forms, adding only the browser', async ({ page }) => {
    await page.goto('/');
    const bug = page.getByRole('link', { name: BUG });
    const feature = page.getByRole('link', { name: FEATURE });
    await expect(bug).toBeVisible();
    await expect(feature).toBeVisible();

    const bugHref = new URL((await bug.getAttribute('href')) ?? '');
    expect(bugHref.origin + bugHref.pathname).toBe(FEEDBACK);
    expect(bugHref.searchParams.get('template')).toBe('bug.yml');
    expect(bugHref.searchParams.get('browser')).toMatch(/^(Chrome|Edge|Firefox|Safari) \d+/);
    expect([...bugHref.searchParams.keys()].every((k) => ['template', 'version', 'browser'].includes(k))).toBe(true); // no board_ref off a board

    const featureHref = new URL((await feature.getAttribute('href')) ?? '');
    expect(featureHref.origin + featureHref.pathname).toBe(FEEDBACK);
    expect([...featureHref.searchParams.keys()]).toEqual(['template']);
    expect(featureHref.searchParams.get('template')).toBe('feature.yml');
  });

  test('are in the user guide header', async ({ page }) => {
    await page.goto('/docs');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: BUG })).toBeVisible();
    await expect(header.getByRole('link', { name: FEATURE })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: BUG })).toHaveCount(0);
  });

  test('on a board they open in a new tab with no referrer and nothing from the board in the URL', async ({ page }) => {
    const seen = await stubFeedbackSite(page);
    const label = `Secret retro ${Date.now()}`;
    await createBoard(page, label);
    const boardUrl = page.url();
    const slug = new URL(boardUrl).pathname.split('/').pop() ?? '';

    for (const name of [BUG, FEATURE]) {
      const link = page.getByRole('contentinfo').getByRole('link', { name });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('target', '_blank');
      expect(await link.getAttribute('rel')).toMatch(/noreferrer/);
      const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
      await popup.waitForLoadState();
      await popup.close();
    }
    expect(seen).toHaveLength(2);
    for (const hit of seen) {
      expect(hit.referer).toBeUndefined();
      expect(hit.url).not.toContain(slug);
      expect(decodeURIComponent(hit.url)).not.toContain(label);
      expect(decodeURIComponent(hit.url)).not.toContain('Tester');
    }
  });

  test('on a board they carry the board reference, with no copying and no slug', async ({ page }) => {
    const seen = await stubFeedbackSite(page);
    await createBoard(page, `Ref retro ${Date.now()}`);
    const slug = new URL(page.url()).pathname.split('/').pop() ?? '';
    const footer = page.getByRole('contentinfo');

    await expect(footer.getByRole('button', { name: /Board ref/ })).toHaveCount(0);

    const bugHref = new URL((await footer.getByRole('link', { name: BUG }).getAttribute('href')) ?? '');
    const ref = bugHref.searchParams.get('board_ref') ?? '';
    expect(ref).toMatch(REF);
    expect(ref.replace(/-/g, '')).not.toContain(slug);
    expect(bugHref.searchParams.get('template')).toBe('bug.yml');
    expect(bugHref.searchParams.get('browser')).toBeTruthy();

    const featureHref = new URL((await footer.getByRole('link', { name: FEATURE }).getAttribute('href')) ?? '');
    expect(featureHref.searchParams.get('board_ref')).toBe(ref);
    expect(featureHref.searchParams.get('template')).toBe('feature.yml');
    expect([...featureHref.searchParams.keys()].sort()).toEqual(['board_ref', 'template']);

    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      footer.getByRole('link', { name: BUG }).click()
    ]);
    await popup.waitForLoadState();
    expect(seen[0].url).toContain(`board_ref=${ref}`);
    expect(seen[0].url).toContain('template=bug.yml');
    expect(seen[0].url).not.toContain(slug);
  });

  test('give the same reference for a board each time and a different one for another board', async ({ page }) => {
    await stubFeedbackSite(page);
    await createBoard(page, `First ${Date.now()}`);
    const refOf = async () => {
      const link = page.getByRole('contentinfo').getByRole('link', { name: FEATURE });
      await expect(link).toBeVisible();
      return new URL((await link.getAttribute('href')) ?? '').searchParams.get('board_ref');
    };
    const first = await refOf();
    expect(first).toMatch(REF);
    await page.reload();
    expect(await refOf()).toBe(first);

    await createBoard(page, `Second ${Date.now()}`);
    const second = await refOf();
    expect(second).toMatch(REF);
    expect(second).not.toBe(first);
  });

  test('are hidden when the server has no FEEDBACK_URL', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, feedbackUrl: null } });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start a new retro' })).toBeVisible();
    await expect(page.getByRole('link', { name: BUG })).toHaveCount(0);
    await expect(page.getByRole('link', { name: FEATURE })).toHaveCount(0);
    await page.goto('/docs');
    await expect(page.getByRole('link', { name: 'User guide' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: BUG })).toHaveCount(0);
    await expect(page.getByRole('link', { name: FEATURE })).toHaveCount(0);
  });

  test('track the click with where it came from and which kind, nothing else', async ({ page }) => {
    await stubFeedbackSite(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __ga: unknown[]; gtag: (t: string, n: string, p: unknown) => void };
      w.__ga = [];
      w.gtag = (t, n, p) => {
        if (t === 'event') w.__ga.push([n, p]);
      };
    });
    await page.goto('/');
    for (const name of [BUG, FEATURE]) {
      const [popup] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('link', { name }).click()
      ]);
      await popup.close();
    }
    const events = await page.evaluate(() => (window as unknown as { __ga: unknown[] }).__ga);
    expect(events).toContainEqual(['feedback_open', { from: 'home', kind: 'bug' }]);
    expect(events).toContainEqual(['feedback_open', { from: 'home', kind: 'feature' }]);
  });
});
