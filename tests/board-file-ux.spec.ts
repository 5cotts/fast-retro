import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * The UX around board files: the Export menu (ExportMenu.svelte), dropping a
 * board file on the homepage (routes/+page.svelte, NewRetroModal.svelte),
 * "Start next retro" bringing action items along (Board.svelte), the note on
 * imported boards, and the analytics events (lib/analytics.ts).
 *
 * Boards are created from the homepage, so the browser is host via its host
 * key and no RETRO_LEAD_TOKEN is needed.
 */

async function stubAnalytics(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __gaEvents: unknown[][]; gtag: (...a: unknown[]) => void };
    w.__gaEvents = [];
    w.gtag = (...args: unknown[]) => {
      w.__gaEvents.push(args);
    };
  });
}

async function gaEvents(page: Page): Promise<unknown[][]> {
  return page.evaluate(() =>
    (window as unknown as { __gaEvents: unknown[][] }).__gaEvents.filter((e) => e[0] === 'event')
  );
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
  const columns = page.getByRole('list', { name: 'What went well' });
  await expect(nameInput.or(columns)).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  await dismissOnboardingIfPresent(page);
  await expect(columns).toBeVisible();
}

async function gotoHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
}

async function createBoardFromHome(page: Page, label: string) {
  await gotoHome(page);
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  await dialog.getByLabel('Retro name').fill(label);
  await dialog.getByRole('button', { name: 'Create retro' }).click();
  await page.waitForURL(/\/board\//);
  await joinIfAsked(page, `host-${Math.random().toString(36).slice(2, 6)}`);
}

function card(page: Page, columnTitle: string, text: string): Locator {
  return page.getByRole('list', { name: columnTitle }).getByRole('group', { name: `Card: ${text}` });
}

async function addCard(page: Page, columnTitle: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${columnTitle}`);
  await draft.click();
  await draft.fill(text);
  await page.getByRole('list', { name: columnTitle }).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(card(page, columnTitle, text)).toBeVisible();
}

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: `Advance to ${label} phase` }).click();
  await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })).toBeVisible();
}

test.describe('fast-retro board file UX', () => {
  let pageErrors: Error[] = [];
  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    await stubAnalytics(page);
  });
  test.afterEach(() => {
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  });

  test('Export menu works by keyboard and offers both formats', async ({ page }) => {
    const suffix = Math.random().toString(36).slice(2, 6);
    await createBoardFromHome(page, `Export menu ${suffix}`);
    await addCard(page, 'What went well', `menu card ${suffix}`);

    const trigger = page.getByRole('button', { name: 'Export', exact: true });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Export' });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const save = menu.getByRole('menuitem', { name: /^Save board file/ });
    const csv = menu.getByRole('menuitem', { name: /^Spreadsheet \(CSV\)/ });
    await expect(save).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(csv).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(save).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    // Enter on the focused item downloads the board file.
    await page.keyboard.press('ArrowDown');
    const [boardFile] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    expect(boardFile.suggestedFilename()).toMatch(new RegExp(`^export-menu-${suffix}-.*\\.fastretro\\.json$`));
    expect(JSON.parse(readFileSync((await boardFile.path()) as string, 'utf-8')).format).toBe('fast-retro');
    await expect(menu).toBeHidden();

    // Clicking outside closes it without choosing anything.
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.getByRole('list', { name: 'What to improve' }).click({ position: { x: 10, y: 10 } });
    await expect(menu).toBeHidden();

    await trigger.click();
    const [sheet] = await Promise.all([page.waitForEvent('download'), csv.click()]);
    expect(sheet.suggestedFilename()).toMatch(/\.csv$/);

    const events = await gaEvents(page);
    expect(events).toContainEqual(['event', 'board_export', { format: 'board_file', source: 'board' }]);
    expect(events).toContainEqual(['event', 'board_export', { format: 'csv', source: 'board' }]);
    // The new events never carry the board label or card text. (The existing
    // page_view event sends the URL, which includes the board slug.)
    expect(JSON.stringify(events.filter((e) => e[1] !== 'page_view'))).not.toContain(suffix);
  });

  test('dropping a board file on the homepage imports it', async ({ page }) => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const text = `dropped card ${suffix}`;
    const file = JSON.stringify({
      format: 'fast-retro',
      version: 1,
      exportedAt: Date.now(),
      board: { label: `Dropped ${suffix}`, anonymous: false, phase: 'brainstorm', autoSort: true },
      cards: {
        wentWell: [{ id: 'c1', text, authorId: 'u_someone', votes: [], reactions: {}, comments: [] }],
        toImprove: [],
        actions: []
      },
      names: { u_someone: 'Someone' }
    });

    await gotoHome(page);
    await expect(page.getByText('Drop it anywhere on this page to import it.')).toBeVisible();

    const dt = await page.evaluateHandle(
      ({ name, contents }) => {
        const d = new DataTransfer();
        d.items.add(new File([contents], name, { type: 'application/json' }));
        return d;
      },
      { name: 'dropped.fastretro.json', contents: file }
    );
    await page.dispatchEvent('body', 'dragover', { dataTransfer: dt });
    await expect(page.getByText('Drop a .fastretro.json file to import it as a new retro')).toBeVisible();
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
    await expect(page.getByText('Drop a .fastretro.json file to import it as a new retro')).toBeHidden();

    const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
    const preview = dialog.getByRole('status', { name: 'Import preview' });
    await expect(preview).toContainText('dropped.fastretro.json');
    await expect(preview).toContainText('1 card');
    await expect(dialog.getByLabel('Retro name')).toHaveValue(`Dropped ${suffix}`);
    await dialog.getByRole('button', { name: 'Import retro' }).click();
    await page.waitForURL(/\/board\//);
    await joinIfAsked(page, `dropper-${suffix}`);

    await expect(card(page, 'What went well', text)).toBeVisible({ timeout: 10_000 });
    await expect(card(page, 'What went well', text).getByText('Someone', { exact: true })).toBeVisible();
    const note = page.getByTestId('imported-note');
    await expect(note).toContainText('Imported from a file');
    await expect(note).toHaveAttribute('title', /uploaded file/);

    expect(await gaEvents(page)).toContainEqual([
      'event',
      'board_import',
      { result: 'success', origin: 'file', cards: 1 }
    ]);
  });

  test('Start next retro brings the action items along by default', async ({ page }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const label = `Carry ${suffix}`;
    const wentWell = `went well ${suffix}`;
    const action = `follow up ${suffix}`;
    const comment = `owner: me ${suffix}`;

    await createBoardFromHome(page, label);
    await addCard(page, 'What went well', wentWell);
    await advance(page, 'Group');
    await advance(page, 'Vote');
    await card(page, 'What went well', wentWell).getByRole('button', { name: /^Upvote/ }).click();
    await advance(page, 'Discuss');
    await advance(page, 'Actions');
    await addCard(page, 'Action items', action);
    {
      const a = card(page, 'Action items', action);
      await a.getByRole('button', { name: 'Add a reaction', exact: true }).click();
      await page.getByLabel('Search emoji').fill('party');
      await page.getByRole('menuitem', { name: 'React with party', exact: true }).click();
      await expect(a.getByRole('button', { name: /Remove your party reaction \(1/ })).toBeVisible();
      await a.getByRole('button', { name: /Comments/ }).click();
      await a.getByPlaceholder('Add a comment…').fill(comment);
      await a.getByRole('button', { name: 'Post' }).click();
      await expect(a.getByText(comment)).toBeVisible();
    }

    await page.getByRole('button', { name: 'End retro' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
    await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });

    const bring = page.getByRole('checkbox', { name: 'Bring 1 action item' });
    await expect(bring).toBeChecked();
    const oldUrl = page.url();
    await page.getByRole('button', { name: 'Start next retro' }).click();
    await page.waitForURL((u) => u.toString() !== oldUrl && /\/board\//.test(u.pathname));
    await joinIfAsked(page, `host-${suffix}`);

    const carried = card(page, 'Action items', action);
    await expect(carried).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveTitle(new RegExp(label));
    await expect(page.getByRole('list', { name: 'What went well' }).getByRole('group', { name: /^Card: / })).toHaveCount(0);
    await expect(carried.getByRole('button', { name: /party reaction/ })).toHaveCount(0);
    await expect(carried.getByRole('button', { name: 'Comments (1)' })).toBeVisible();
    await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: 'Brainstorm' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn off anonymous mode' })).toBeVisible();
    await expect(page.getByTestId('imported-note')).toContainText(`Action items from “${label}”`);
    await expect(page.getByText('This retro has ended')).toHaveCount(0);

    expect(await gaEvents(page)).toContainEqual(['event', 'next_retro', { carried_actions: 1 }]);
  });
});
