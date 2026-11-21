import { test, expect, type Page } from '@playwright/test';

/**
 * The "Send feedback" link (frontend/src/lib/FeedbackLink.svelte, FEEDBACK_URL).
 * test-local.sh sets FEEDBACK_URL=https://example.com/issues/new/choose.
 * Plan: docs/feedback-intake-investigation.md, option D.
 *
 * The link opens a public page from inside a board, so what matters most is
 * what leaves with it: no referrer, and nothing from the board in the URL.
 */

const FEEDBACK = 'https://example.com/issues/new/choose';

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

test.describe('send feedback link', () => {
  test('is on the home page and points at FEEDBACK_URL, adding only the browser', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Send feedback' });
    await expect(link).toBeVisible();
    const href = new URL((await link.getAttribute('href')) ?? '');
    expect(href.origin + href.pathname).toBe(FEEDBACK);
    expect([...href.searchParams.keys()].every((k) => k === 'version' || k === 'browser')).toBe(true); // no board_ref off a board
    expect(href.searchParams.get('browser')).toMatch(/^(Chrome|Edge|Firefox|Safari) \d+/);
  });

  test('is in the user guide header', async ({ page }) => {
    await page.goto('/docs');
    const link = page.getByRole('banner').getByRole('link', { name: 'Send feedback' });
    await expect(link).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Send feedback' })).toHaveCount(0);
  });

  test('on a board it opens in a new tab with no referrer and nothing from the board in the URL', async ({ page }) => {
    const seen = await stubFeedbackSite(page);
    const label = `Secret retro ${Date.now()}`;
    await createBoard(page, label);
    const boardUrl = page.url();

    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Send feedback' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await link.getAttribute('rel')).toMatch(/noreferrer/);

    const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await popup.waitForLoadState();
    expect(seen).toHaveLength(1);
    expect(seen[0].referer).toBeUndefined();
    const slug = new URL(boardUrl).pathname.split('/').pop() ?? '';
    expect(seen[0].url).not.toContain(slug);
    expect(decodeURIComponent(seen[0].url)).not.toContain(label);
    expect(decodeURIComponent(seen[0].url)).not.toContain('Tester');
  });

  test('on a board it shows a board reference that is safe to share and copies it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const seen = await stubFeedbackSite(page);
    await createBoard(page, `Ref retro ${Date.now()}`);
    const slug = new URL(page.url()).pathname.split('/').pop() ?? '';

    // By title, not name: the label changes to "Copied" after a click.
    const button = page.getByRole('contentinfo').getByTitle(/^Paste this reference/);
    await expect(button).toBeVisible();
    const text = (await button.textContent()) ?? '';
    const ref = text.replace('Board ref', '').trim();
    expect(ref).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(ref.replace(/-/g, '')).not.toContain(slug);

    await button.click();
    await expect(button).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ref);

    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Send feedback' });
    const href = new URL((await link.getAttribute('href')) ?? '');
    expect(href.searchParams.get('board_ref')).toBe(ref);
    expect(decodeURIComponent(href.toString())).not.toContain(slug);

    const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
    await popup.waitForLoadState();
    expect(seen[0].url).toContain(`board_ref=${ref}`);
    expect(seen[0].url).not.toContain(slug);
  });

  test('gives the same reference for a board each time and a different one for another board', async ({ page }) => {
    await stubFeedbackSite(page);
    await createBoard(page, `First ${Date.now()}`);
    const refOf = async () =>
      ((await page.getByRole('contentinfo').getByTitle(/^Paste this reference/).textContent()) ?? '').trim();
    const first = await refOf();
    await page.reload();
    await expect(page.getByRole('contentinfo').getByTitle(/^Paste this reference/)).toBeVisible();
    expect(await refOf()).toBe(first);

    await createBoard(page, `Second ${Date.now()}`);
    expect(await refOf()).not.toBe(first);
  });

  test('has no board reference on the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Send feedback' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Board ref / })).toHaveCount(0);
  });

  test('is hidden when the server has no FEEDBACK_URL', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, feedbackUrl: null } });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start a new retro' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Send feedback' })).toHaveCount(0);
    await page.goto('/docs');
    await expect(page.getByRole('link', { name: 'User guide' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Send feedback' })).toHaveCount(0);
  });

  test('tracks the click with where it came from and nothing else', async ({ page }) => {
    await stubFeedbackSite(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __ga: unknown[]; gtag: (t: string, n: string, p: unknown) => void };
      w.__ga = [];
      w.gtag = (t, n, p) => {
        if (t === 'event') w.__ga.push([n, p]);
      };
    });
    await page.goto('/');
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: 'Send feedback' }).click()
    ]);
    await popup.close();
    const events = await page.evaluate(() => (window as unknown as { __ga: unknown[] }).__ga);
    expect(events).toContainEqual(['feedback_open', { from: 'home' }]);
  });
});
