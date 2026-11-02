import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Hide others' cards while brainstorming (frontend/src/lib/visibility.ts,
 * HiddenCard.svelte). During Brainstorm each person sees only their own
 * cards; others' cards are placeholders with no text in the page. Moving to
 * Group reveals everything live, going back hides again, turning the setting
 * off reveals at once, action items are never hidden, and an ended board
 * shows everything.
 *
 * Boards are created from the homepage, so no RETRO_LEAD_TOKEN is needed.
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

function column(page: Page, title: string) {
  return page.getByRole('list', { name: title, exact: true });
}

function card(page: Page, title: string, text: string) {
  return column(page, title).getByRole('group', { name: `Card: ${text}` });
}

function hidden(page: Page, title: string) {
  return column(page, title).getByTestId('hidden-card');
}

async function addCard(page: Page, title: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${title}`, { exact: true });
  await draft.click();
  await draft.fill(text);
  await column(page, title).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(card(page, title, text)).toBeVisible();
}

async function openNewRetroDialog(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  return page.getByRole('dialog', { name: 'Start a new retro' });
}

async function goToPhase(page: Page, direction: 'Advance to' | 'Go back to', label: string) {
  await page.getByRole('button', { name: `${direction} ${label} phase` }).click();
  await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })).toBeVisible();
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe('fast-retro hidden cards', () => {
  test("others' cards stay hidden during Brainstorm and are revealed in Group", async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const hostText = `host secret ${suffix}`;
    const guestText = `guest idea ${suffix}`;
    const host = await newPage(browser);
    const guest = await newPage(browser);
    const late = await newPage(browser);
    try {
      const dialog = await openNewRetroDialog(host.page);
      await dialog.getByLabel('Retro name').fill(`Hidden ${suffix}`);
      await dialog.getByLabel("Hide others' cards while brainstorming").check();
      await dialog.getByRole('button', { name: 'Create retro' }).click();
      await host.page.waitForURL(/\/board\//);
      await joinIfAsked(host.page, `Host ${suffix}`);
      await expect(host.page.getByTestId('hidden-cards-banner')).toBeVisible();
      await expect(host.page.getByRole('button', { name: "Stop hiding others' cards" })).toBeVisible();

      await guest.page.goto(host.page.url());
      await joinIfAsked(guest.page, `Guest ${suffix}`);
      await expect(guest.page.getByTestId('hidden-cards-banner')).toBeVisible();

      await addCard(host.page, 'What went well', hostText);
      await addCard(guest.page, 'What went well', guestText);

      // Each sees their own card and a placeholder for the other's, and the
      // other's text is nowhere in the page.
      await expect(hidden(guest.page, 'What went well')).toHaveCount(1);
      await expect(hidden(host.page, 'What went well')).toHaveCount(1);
      await expect(card(guest.page, 'What went well', guestText)).toBeVisible();
      await expect(column(guest.page, 'What went well').getByText('2', { exact: true })).toBeVisible();
      expect(await guest.page.content()).not.toContain(hostText);
      expect(await host.page.content()).not.toContain(guestText);

      // Group reveals everything live, with no reload.
      await goToPhase(host.page, 'Advance to', 'Group');
      await expect(card(guest.page, 'What went well', hostText)).toBeVisible({ timeout: 10_000 });
      await expect(hidden(guest.page, 'What went well')).toHaveCount(0);
      await expect(guest.page.getByTestId('hidden-cards-banner')).toBeHidden();

      // Going back to Brainstorm hides them again.
      await goToPhase(host.page, 'Go back to', 'Brainstorm');
      await expect(hidden(guest.page, 'What went well')).toHaveCount(1, { timeout: 10_000 });
      await expect(card(guest.page, 'What went well', hostText)).toHaveCount(0);

      // Turning the setting off reveals at once.
      await host.page.getByRole('button', { name: "Stop hiding others' cards" }).click();
      await expect(card(guest.page, 'What went well', hostText)).toBeVisible({ timeout: 10_000 });
      await host.page.getByRole('button', { name: "Hide others' cards while brainstorming" }).click();
      await expect(hidden(guest.page, 'What went well')).toHaveCount(1, { timeout: 10_000 });

      // Ending the retro during Brainstorm shows everything, live and to a
      // later visitor.
      await host.page.getByRole('button', { name: 'End retro' }).click();
      await host.page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      await expect(host.page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      await expect(card(guest.page, 'What went well', hostText)).toBeVisible({ timeout: 10_000 });
      await expect(card(host.page, 'What went well', guestText)).toBeVisible();
      await late.page.goto(host.page.url());
      await expect(card(late.page, 'What went well', guestText)).toBeVisible({ timeout: 10_000 });
      await expect(late.page.getByTestId('hidden-card')).toHaveCount(0);
    } finally {
      await host.ctx.close();
      await guest.ctx.close();
      await late.ctx.close();
    }
  });

  test('action items are never hidden, and the setting comes back from a file', async ({ browser }) => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const file = {
      format: 'fast-retro',
      version: 1,
      exportedAt: Date.now(),
      board: { label: `Carried ${suffix}`, anonymous: true, phase: 'brainstorm', autoSort: true, hideCards: true },
      cards: {
        wentWell: [{ id: 'a', text: `someone else's idea ${suffix}`, authorId: 'u_other', votes: [], reactions: {}, comments: [] }],
        toImprove: [],
        actions: [{ id: 'b', text: `follow up ${suffix}`, authorId: 'u_other', votes: [], reactions: {}, comments: [] }]
      }
    };
    const { ctx, page } = await newPage(browser);
    try {
      const dialog = await openNewRetroDialog(page);
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        dialog.getByRole('button', { name: 'Import from file…' }).click()
      ]);
      await chooser.setFiles({ name: 'carried.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await dialog.getByRole('button', { name: 'Import retro' }).click();
      await page.waitForURL(/\/board\//);
      await joinIfAsked(page, `Importer ${suffix}`);
      await expect(page.getByTestId('hidden-cards-banner')).toBeVisible();
      await expect(hidden(page, 'What went well')).toHaveCount(1);
      await expect(card(page, 'Action items', `follow up ${suffix}`)).toBeVisible();
      await expect(hidden(page, 'Action items')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
