import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Edit board (plan: docs/edit-board-plan.md). The host reopens the board's
 * setup after creating it: adds, renames, reorders and removes columns,
 * turns Action items off, and changes options. A second browser sees each
 * change live, cards stay with their column, removing a column with cards
 * warns first, and only the host of a live board gets the button. The host
 * can also rename a column by clicking its title.
 *
 * Boards are created from the homepage dialog, so the creating browser is
 * host via its host key.
 */

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

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: `Advance to ${label} phase` }).click();
  await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })).toBeVisible();
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __gaEvents: unknown[][]; gtag: (...args: unknown[]) => void };
    w.__gaEvents = [];
    w.gtag = (...args: unknown[]) => {
      w.__gaEvents.push(args);
    };
  });
  return { ctx, page };
}

async function gaEvents(page: Page, name: string) {
  return page.evaluate(
    (n) => (window as unknown as { __gaEvents: unknown[][] }).__gaEvents.filter((e) => e[0] === 'event' && e[1] === n),
    name
  );
}

// A classic retro, created from the homepage dialog.
async function createRetro(page: Page, label: string) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  await dialog.getByLabel('Retro name').fill(label);
  await dialog.getByRole('button', { name: 'Create retro' }).click();
  await page.waitForURL(/\/board\//);
  await joinIfAsked(page, 'Host');
}

async function openEditBoard(page: Page) {
  await page.getByRole('button', { name: 'Edit board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit board' });
  await expect(dialog).toBeVisible();
  return dialog;
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

test.describe('fast-retro edit board', () => {
  test('the host adds, renames, reorders and removes columns mid-Brainstorm', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const host = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await createRetro(host.page, `Edit ${suffix}`);
      await guest.page.goto(host.page.url());
      await joinIfAsked(guest.page, 'Guest');
      await expect(guest.page.getByRole('button', { name: 'Edit board' })).toHaveCount(0);

      await addCard(host.page, 'What went well', `went well ${suffix}`);
      await addCard(guest.page, 'What to improve', `improve ${suffix}`);
      await expect(card(host.page, 'What to improve', `improve ${suffix}`)).toBeVisible({ timeout: 10_000 });

      // Add, rename and reorder in one save.
      let dialog = await openEditBoard(host.page);
      await expect(dialog.getByLabel('Retro name')).toHaveValue(`Edit ${suffix}`);
      await expect(dialog.getByLabel('Column 1 name')).toHaveValue('What went well');
      await expect(dialog.getByRole('checkbox', { name: /^Action items column/ })).toBeChecked();
      await dialog.getByLabel('Column 1 name').fill('Went well');
      await dialog.getByRole('button', { name: 'Move column 2 up' }).click();
      await expect(dialog.getByLabel('Column 1 name')).toHaveValue('What to improve');
      await dialog.getByRole('button', { name: 'Add column' }).click();
      await expect(dialog.getByLabel('Column 3 name')).toBeFocused();
      await host.page.keyboard.type('Kudos');
      await expect(dialog.getByTestId('edit-board-warning')).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toHaveCount(0);

      const afterFirst = ['What to improve', 'Went well', 'Kudos', 'Action items'];
      expect(await columnTitles(host.page)).toEqual(afterFirst);
      await expect.poll(() => columnTitles(guest.page), { timeout: 10_000 }).toEqual(afterFirst);
      await expect(card(guest.page, 'Went well', `went well ${suffix}`)).toBeVisible();
      await expect(card(guest.page, 'What to improve', `improve ${suffix}`)).toBeVisible();
      // Nothing was removed, so nobody is told the columns changed. Counted
      // once rather than awaited: the notice dismisses itself after 8s, so a
      // retrying assertion would pass even if it had shown.
      expect(await guest.page.getByTestId('columns-changed-notice').count()).toBe(0);
      await addCard(guest.page, 'Kudos', `kudos ${suffix}`);
      await expect(card(host.page, 'Kudos', `kudos ${suffix}`)).toBeVisible({ timeout: 10_000 });

      // Removing a column with cards warns with the count, then deletes them.
      dialog = await openEditBoard(host.page);
      await dialog.getByRole('button', { name: 'Remove column 1' }).click();
      await expect(dialog.getByTestId('edit-board-warning')).toHaveText('Removing What to improve deletes its 1 card.');
      await dialog.getByRole('checkbox', { name: /^Hide others' cards/ }).check();
      await dialog.getByRole('button', { name: 'Save and delete 1 card' }).click();
      await expect(dialog).toHaveCount(0);

      const afterSecond = ['Went well', 'Kudos', 'Action items'];
      expect(await columnTitles(host.page)).toEqual(afterSecond);
      await expect.poll(() => columnTitles(guest.page), { timeout: 10_000 }).toEqual(afterSecond);
      await expect(guest.page.getByTestId('columns-changed-notice')).toHaveText(/The host changed the columns/);
      // The host who saved isn't notified about their own change.
      expect(await host.page.getByTestId('columns-changed-notice').count()).toBe(0);
      await expect(host.page.getByRole('button', { name: "Stop hiding others' cards" })).toHaveAttribute('aria-pressed', 'true');

      // Cancel changes nothing.
      dialog = await openEditBoard(host.page);
      await dialog.getByLabel('Column 1 name').fill('Not saved');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      expect(await columnTitles(host.page)).toEqual(afterSecond);

      // An export after the edits has the new columns.
      const file = JSON.parse(await download(host.page, /^Save board file/));
      expect(file.board.columns.map((c: { title: string }) => c.title)).toEqual(afterSecond);
      expect(file.board.hideCards).toBe(true);

      expect(await gaEvents(host.page, 'board_edit')).toEqual([
        ['event', 'board_edit', { source: 'dialog', added: 1, removed: 0, renamed: 1, reordered: true, settings_changed: 0 }],
        ['event', 'board_edit', { source: 'dialog', added: 0, removed: 1, renamed: 0, reordered: false, settings_changed: 1 }]
      ]);
    } finally {
      await host.ctx.close();
      await guest.ctx.close();
    }
  });

  test('turning Action items off in the Actions phase lands the board in Discuss', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      await createRetro(page, `Actions off ${suffix}`);
      await advance(page, 'Group');
      await advance(page, 'Vote');
      await advance(page, 'Discuss');
      await advance(page, 'Actions');
      await addCard(page, 'Action items', `todo ${suffix}`);

      const dialog = await openEditBoard(page);
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      await dialog.getByRole('checkbox', { name: /^Action items column/ }).uncheck();
      await expect(dialog.getByTestId('edit-board-warning')).toHaveText('Removing Action items deletes its 1 card.');
      await dialog.getByRole('button', { name: 'Save and delete 1 card' }).click();

      expect(await columnTitles(page)).toEqual(['What went well', 'What to improve']);
      const phases = page.getByRole('list', { name: 'Phases' }).getByRole('listitem');
      await expect(phases).toHaveText([/Brainstorm/, /Group/, /Vote/, /Discuss/]);
      await expect(page.locator('[role="listitem"][aria-current="step"]')).toHaveText(/Discuss/);
      await expect(page.getByRole('button', { name: /^Advance to/ })).toHaveCount(0);

      // Turning it back on brings back an empty Action items column.
      const again = await openEditBoard(page);
      await again.getByRole('checkbox', { name: /^Action items column/ }).check();
      await again.getByRole('button', { name: 'Save', exact: true }).click();
      expect(await columnTitles(page)).toEqual(['What went well', 'What to improve', 'Action items']);
      await expect(column(page, 'Action items').getByRole('group', { name: /^Card: / })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Advance to Actions phase' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('the host renames a column by clicking its title', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const host = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await createRetro(host.page, `Inline ${suffix}`);
      await guest.page.goto(host.page.url());
      await joinIfAsked(guest.page, 'Guest');
      await addCard(guest.page, 'What went well', `kept ${suffix}`);

      // Participants get a plain heading, not a button.
      await expect(column(guest.page, 'What went well').getByRole('heading', { level: 2 })).toHaveText('What went well');
      await expect(column(guest.page, 'What went well').getByRole('button', { name: 'What went well', exact: true })).toHaveCount(0);

      // Enter saves; the guest sees it live and the card stays.
      const title = column(host.page, 'What went well').getByRole('button', { name: 'What went well', exact: true });
      await title.click();
      const input = host.page.getByRole('textbox', { name: 'Column name' });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('What went well');
      await input.fill('Wins');
      await input.press('Enter');
      await expect.poll(() => columnTitles(guest.page), { timeout: 10_000 }).toEqual(['Wins', 'What to improve', 'Action items']);
      await expect(card(guest.page, 'Wins', `kept ${suffix}`)).toBeVisible();
      await expect(column(host.page, 'Wins').getByRole('button', { name: 'Wins', exact: true })).toBeFocused();

      // Escape cancels, and a blank title keeps the old one.
      await column(host.page, 'What to improve').getByRole('button', { name: 'What to improve', exact: true }).click();
      await input.fill('Not saved');
      await input.press('Escape');
      await expect(input).toHaveCount(0);
      await column(host.page, 'What to improve').getByRole('button', { name: 'What to improve', exact: true }).click();
      await input.fill('   ');
      await input.press('Enter');
      expect(await columnTitles(host.page)).toEqual(['Wins', 'What to improve', 'Action items']);

      // Clicking away saves too, and Action items can be renamed.
      await column(host.page, 'Action items').getByRole('button', { name: 'Action items', exact: true }).click();
      await input.fill('Next steps');
      await host.page.getByTestId('board-columns').click({ position: { x: 5, y: 5 } });
      await expect.poll(() => columnTitles(guest.page), { timeout: 10_000 }).toEqual(['Wins', 'What to improve', 'Next steps']);
      // A rename removes nothing, so nobody gets the columns-changed notice.
      expect(await guest.page.getByTestId('columns-changed-notice').count()).toBe(0);

      expect(await gaEvents(host.page, 'board_edit')).toEqual([
        ['event', 'board_edit', { source: 'inline', added: 0, removed: 0, renamed: 1, reordered: false, settings_changed: 0 }],
        ['event', 'board_edit', { source: 'inline', added: 0, removed: 0, renamed: 1, reordered: false, settings_changed: 0 }]
      ]);

      // Ended boards show plain headings, even to the host.
      await host.page.getByRole('button', { name: 'End retro' }).click();
      await host.page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      await expect(host.page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      await expect(column(host.page, 'Wins').getByRole('button', { name: 'Wins', exact: true })).toHaveCount(0);
    } finally {
      await host.ctx.close();
      await guest.ctx.close();
    }
  });

  test('a board needs at least one named column, and ended boards have no Edit button', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const { ctx, page } = await newPage(browser);
    try {
      await createRetro(page, `Locked ${suffix}`);
      const dialog = await openEditBoard(page);
      await dialog.getByRole('button', { name: 'Remove column 2' }).click();
      await expect(dialog.getByRole('button', { name: 'Remove column 1' })).toBeDisabled();
      await dialog.getByLabel('Column 1 name').fill('   ');
      await expect(dialog.getByText('Name at least one column.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(await columnTitles(page)).toEqual(['What went well', 'What to improve', 'Action items']);

      await page.getByRole('button', { name: 'End retro' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Edit board' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
