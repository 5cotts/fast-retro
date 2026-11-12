import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Presenting (frontend/src/lib/viewer.ts, PresentButton.svelte): a host can
 * draw their tab the way everyone else sees the board, so sharing their screen
 * doesn't show which cards, votes, reactions and comments are theirs. It lives
 * only in the tab's URL (?present) and changes nothing for anyone else.
 * Plan: docs/presenter-mode-plan.md.
 *
 * Boards are created from the homepage, so no RETRO_LEAD_TOKEN is needed.
 */

async function newPage(browser: Browser, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  return { ctx, page: await ctx.newPage() };
}

async function join(page: Page, name: string, ready = page.getByTestId('board-columns')) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput.or(ready)).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  await expect(ready).toBeVisible();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(gotIt).toBeHidden();
}

async function openNewRetroDialog(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  return page.getByRole('dialog', { name: 'Start a new retro' });
}

async function createBoard(page: Page, label: string, opts: { hideCards?: boolean; canvas?: string } = {}) {
  const dialog = await openNewRetroDialog(page);
  await dialog.getByLabel('Retro name').fill(label);
  if (opts.canvas) {
    await dialog.getByRole('radiogroup', { name: 'Board type' }).getByText('Canvas', { exact: true }).click();
    await dialog.getByLabel('Prompt 1 name').fill(opts.canvas);
  }
  if (opts.hideCards) await dialog.getByLabel(/Hide others' cards/).check();
  await dialog.getByRole('button', { name: 'Create retro' }).click();
  await page.waitForURL(/\/board\//);
  await join(page, 'Host', opts.canvas ? page.getByTestId('board-canvas') : undefined);
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

async function advance(page: Page, times = 1) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: /^Advance to / }).click();
}

async function goBack(page: Page, times = 1) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: /^Go back to / }).click();
}

async function present(page: Page) {
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Present in this tab/ }).click();
  await expect(page.getByTestId('presenting-pill')).toBeVisible();
  await expect(page).toHaveURL(/\?present$/);
}

async function stop(page: Page) {
  await page.getByRole('button', { name: 'Stop presenting' }).click();
  await expect(page.getByTestId('presenting-pill')).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]present/);
}

test.describe('presenting', () => {
  test("a host's cards, votes, reactions and comments aren't marked as theirs, and nobody else's screen changes", async ({ browser }) => {
    test.setTimeout(120_000);
    const s = Math.random().toString(36).slice(2, 6);
    const text = `Host idea ${s}`;
    const comment = `Host note ${s}`;
    const host = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await host.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await createBoard(host.page, `Present ${s}`);
      await guest.page.goto(host.page.url());
      await join(guest.page, 'Guest');

      // The host writes a card, reacts and comments in Brainstorm, then votes.
      await addCard(host.page, 'What went well', text);
      const mine = card(host.page, 'What went well', text);
      await mine.getByRole('button', { name: 'Add a reaction', exact: true }).click();
      await host.page.getByLabel('Search emoji').fill('party');
      await host.page.getByRole('menuitem', { name: 'React with party', exact: true }).click();
      await expect(mine.getByRole('button', { name: /^Remove your party reaction \(1/ })).toBeVisible();
      if (!(await mine.getByPlaceholder('Add a comment…').isVisible())) {
        await mine.getByRole('button', { name: /^Comments/ }).click();
      }
      await mine.getByPlaceholder('Add a comment…').fill(comment);
      await mine.getByRole('button', { name: 'Post' }).click();
      await advance(host.page, 2);
      await mine.getByRole('button', { name: /^Upvote/ }).click();
      await expect(mine.getByRole('button', { name: 'Remove vote (1)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(mine.getByText('you (hidden)', { exact: true })).toBeVisible();
      await expect(mine.getByText('(you, hidden)')).toBeVisible();

      // Guests never get the button.
      await expect(guest.page.getByRole('button', { name: 'Present', exact: true })).toHaveCount(0);

      await present(host.page);
      const vote = mine.getByRole('button', { name: 'Voting paused while you present (1 votes)' });
      await expect(vote).toBeDisabled();
      await expect(vote).toHaveAttribute('aria-pressed', 'false');
      const chip = mine.getByRole('button', { name: /^party reaction \(1\)/ });
      await expect(chip).toBeDisabled();
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(mine.getByRole('button', { name: 'Add a reaction', exact: true })).toHaveCount(0);
      await expect(mine.getByText(/\byou\b/)).toHaveCount(0);
      await expect(mine.getByText('Anonymous', { exact: true })).toHaveCount(2);
      // Adding comments still works while presenting.
      await mine.getByPlaceholder('Add a comment…').fill(`Live note ${s}`);
      await mine.getByRole('button', { name: 'Post' }).click();
      await expect(mine.getByText(`Live note ${s}`)).toBeVisible();

      // Share copies the participant link, never ?present.
      await host.page.getByRole('button', { name: 'Copy board link to share with teammates' }).click();
      const copied = await host.page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toMatch(/\/board\/[^/?]+$/);

      // A reload keeps presenting.
      await host.page.reload();
      await join(host.page, 'Host');
      await expect(host.page.getByTestId('presenting-pill')).toBeVisible();
      await expect(mine.getByRole('button', { name: /^Voting paused while you present/ })).toBeDisabled();

      // The guest's screen is unchanged: they can still vote on the host's card.
      const theirs = card(guest.page, 'What went well', text);
      await expect(theirs.getByRole('button', { name: 'Upvote (1)' })).toBeEnabled();
      await theirs.getByRole('button', { name: 'Upvote (1)' }).click();
      await expect(theirs.getByRole('button', { name: 'Remove vote (2)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(mine.getByRole('button', { name: 'Voting paused while you present (2 votes)' })).toBeVisible();

      // A guest handed a ?present link just sees their normal board.
      await guest.page.goto(host.page.url());
      await join(guest.page, 'Guest');
      await expect(guest.page.getByTestId('presenting-pill')).toHaveCount(0);
      await expect(theirs.getByRole('button', { name: 'Remove vote (2)' })).toHaveAttribute('aria-pressed', 'true');

      // Stop puts everything back.
      await stop(host.page);
      await expect(mine.getByRole('button', { name: 'Remove vote (2)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(mine.getByRole('button', { name: /^Remove your party reaction/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(mine.getByText('you (hidden)', { exact: true })).toBeVisible();
    } finally {
      await host.ctx.close();
      await guest.ctx.close();
    }
  });

  test("with Hide cards on, a presenting host's own Brainstorm cards are placeholders, but action items aren't", async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const idea = `Secret idea ${s}`;
    const action = `Carry over ${s}`;
    const { ctx, page } = await newPage(browser);
    try {
      await createBoard(page, `Hidden ${s}`, { hideCards: true });
      await addCard(page, 'What went well', idea);
      await advance(page, 4);
      await addCard(page, 'Action items', action);
      await goBack(page, 4);
      await expect(page.getByTestId('hidden-cards-banner')).toContainText('You only see your own.');

      await present(page);
      await expect(column(page, 'What went well').getByTestId('hidden-card')).toHaveCount(1);
      await expect(page.getByText(idea)).toHaveCount(0);
      await expect(card(page, 'Action items', action)).toBeVisible();
      await expect(page.getByTestId('hidden-cards-banner')).toContainText('Everyone sees only their own.');

      await stop(page);
      await expect(card(page, 'What went well', idea)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("on a canvas with Hide cards on, a presenting host's card is a placeholder in Canvas and List view", async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const idea = `Canvas secret ${s}`;
    const { ctx, page } = await newPage(browser, { width: 1400, height: 900 });
    try {
      await createBoard(page, `Canvas ${s}`, { hideCards: true, canvas: 'Ideas' });
      const composer = page.getByTestId('canvas-composer');
      await composer.getByRole('textbox').fill(idea);
      await composer.getByRole('textbox').press('Enter');
      await expect(page.getByTestId('canvas-card').filter({ hasText: idea })).toBeVisible();

      await present(page);
      await expect(page.getByTestId('canvas-card').getByTestId('hidden-card')).toHaveCount(1);
      await expect(page.getByText(idea)).toHaveCount(0);

      await page.getByRole('group', { name: 'Board view' }).getByRole('button', { name: 'List', exact: true }).click();
      await expect(page.getByTestId('board-columns').getByTestId('hidden-card')).toHaveCount(1);
      await expect(page.getByText(idea)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('a host can present an ended board', async ({ browser }) => {
    test.setTimeout(90_000);
    const s = Math.random().toString(36).slice(2, 6);
    const text = `Ended idea ${s}`;
    const { ctx, page } = await newPage(browser);
    try {
      await createBoard(page, `Ended ${s}`);
      await addCard(page, 'What went well', text);
      await advance(page, 2);
      await card(page, 'What went well', text).getByRole('button', { name: /^Upvote/ }).click();
      await page.getByRole('button', { name: 'End retro' }).click();
      await page.getByRole('button', { name: 'Archive & end' }).click();
      await expect(page.getByRole('button', { name: 'Start next retro' })).toBeVisible();

      await present(page);
      const vote = card(page, 'What went well', text).getByRole('button', { name: /^Voting paused while you present/ });
      await expect(vote).toHaveAttribute('aria-pressed', 'false');
    } finally {
      await ctx.close();
    }
  });
});
