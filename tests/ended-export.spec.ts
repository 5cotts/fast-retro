import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Exporting a retro after it has ended (plan: PR #27). Anyone who can open an
 * ended board gets the Export menu in the "This retro has ended" banner,
 * without having to enter a name and without the end-of-retro celebration
 * replaying, and the file matches a live export of the same board.
 *
 * Skipped unless RETRO_LEAD_TOKEN is set (the board is hosted on the lead route).
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function join(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole('button', { name: 'Join the retro' }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole('list', { name: 'What went well' })).toBeVisible();
}

async function addCard(page: Page, columnTitle: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${columnTitle}`);
  await draft.click();
  await draft.fill(text);
  const column = page.getByRole('list', { name: columnTitle });
  await column.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(column.getByRole('group', { name: `Card: ${text}` })).toBeVisible();
}

function cardLocator(page: Page, columnTitle: string, text: string) {
  return page.getByRole('list', { name: columnTitle }).getByRole('group', { name: `Card: ${text}` });
}

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: `Advance to ${label} phase` }).click();
  await expect(
    page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })
  ).toBeVisible();
}

async function exportAs(page: Page, item: RegExp): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: item }).click();
    })()
  ]);
  return readFileSync((await download.path()) as string, 'utf-8');
}

const saveBoardFile = (page: Page) => exportAs(page, /^Save board file/);
const saveCSV = (page: Page) => exportAs(page, /^Spreadsheet/);

// Everything except the export timestamp, which differs between downloads.
function withoutTimestamp(text: string) {
  const { exportedAt: _ignored, ...rest } = JSON.parse(text);
  return rest;
}

async function endRetro(page: Page) {
  await page.getByRole('button', { name: 'End retro' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
  await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
}

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

// A visitor who has never used fast-retro: no stored name, no host key.
async function openAsGuest(browser: Browser, slug: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await stubAnalytics(page);
  await page.goto(`/board/${slug}`);
  await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Your display name')).toHaveCount(0);
  return { ctx, page };
}

test.describe('exporting an ended retro', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('host, participant and a nameless guest can all export it', async ({ browser }) => {
    test.setTimeout(150_000);

    const slug = `pw-ended-export-${Date.now()}`;
    const suffix = Math.random().toString(36).slice(2, 6);
    const leadName = `Lead ${suffix}`;
    const aliceName = `Alice ${suffix}`;
    const good = `went great 🎉 ${suffix}`;
    const action = `follow up ${suffix}`;
    const comment = `agreed ${suffix}`;

    const leadCtx = await browser.newContext();
    const aliceCtx = await browser.newContext();
    const lead = await leadCtx.newPage();
    const alice = await aliceCtx.newPage();
    const extra: { close: () => Promise<void> }[] = [];

    try {
      await lead.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await join(lead, leadName);
      await alice.goto(`/board/${slug}`);
      await join(alice, aliceName);

      await addCard(alice, 'What went well', good);
      await expect(cardLocator(lead, 'What went well', good)).toBeVisible({ timeout: 10_000 });
      await advance(lead, 'Group');
      await advance(lead, 'Vote');
      await cardLocator(lead, 'What went well', good).getByRole('button', { name: /^Upvote/ }).click();
      await advance(lead, 'Discuss');
      {
        const card = cardLocator(alice, 'What went well', good);
        await card.getByRole('button', { name: 'Add a reaction', exact: true }).click();
        await alice.getByLabel('Search emoji').fill('party');
        await alice.getByRole('menuitem', { name: 'React with party', exact: true }).click();
        await expect(card.getByRole('button', { name: /Remove your party reaction \(1/ })).toBeVisible();
        await card.getByRole('button', { name: /Comments/ }).click();
        await card.getByPlaceholder('Add a comment…').fill(comment);
        await card.getByRole('button', { name: 'Post' }).click();
        await expect(card.getByText(comment)).toBeVisible();
      }
      await advance(lead, 'Actions');
      await addCard(lead, 'Action items', action);
      await expect(
        cardLocator(lead, 'What went well', good).getByRole('button', { name: /Comments \(1\)/ })
      ).toBeVisible({ timeout: 10_000 });

      const live = withoutTimestamp(await saveBoardFile(lead));
      expect(live.names).toMatchObject({ [live.cards.wentWell[0].authorId]: aliceName });

      await endRetro(lead);

      // The header's Export menu is a host control and goes away on an ended
      // board; the banner's menu is the only one left.
      await expect(lead.getByRole('button', { name: 'Export', exact: true })).toHaveCount(1);

      // A participant who was on the board when it ended.
      await expect(alice.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      expect(withoutTimestamp(await saveBoardFile(alice))).toEqual(live);

      // The host, after a reload.
      await lead.reload();
      await expect(lead.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      await expect(cardLocator(lead, 'What went well', good)).toBeVisible();
      // Reopening an ended board doesn't replay the end-of-retro celebration.
      await expect(lead.getByTestId('end-celebration-toast')).toHaveCount(0);
      expect(withoutTimestamp(await saveBoardFile(lead))).toEqual(live);

      // Someone who has never used fast-retro: no name prompt, read-only board,
      // both formats export.
      const guest = await openAsGuest(browser, slug);
      extra.push(guest.ctx);
      await expect(cardLocator(guest.page, 'What went well', good)).toBeVisible();
      await expect(guest.page.getByLabel('Add a card to What went well')).toHaveCount(0);
      await expect(guest.page.getByTestId('end-celebration-toast')).toHaveCount(0);
      await expect(guest.page.locator('canvas')).toHaveCount(0);
      const guestFile = await saveBoardFile(guest.page);
      expect(withoutTimestamp(guestFile)).toEqual(live);
      const csv = await saveCSV(guest.page);
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain(good);
      expect(csv).toContain(action);
      expect(csv).toContain(comment);
      const exports = (await gaEvents(guest.page)).filter((e) => e[1] === 'board_export');
      expect(exports).toEqual([
        ['event', 'board_export', { format: 'board_file', source: 'ended' }],
        ['event', 'board_export', { format: 'csv', source: 'ended' }]
      ]);

      // The guest's file imports like any other board file.
      const importerCtx = await browser.newContext();
      extra.push(importerCtx);
      const importer = await importerCtx.newPage();
      await importer.addInitScript(() => {
        localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
      });
      await importer.goto('/');
      await importer.getByRole('button', { name: 'Start a new retro' }).click();
      const dialog = importer.getByRole('dialog', { name: 'Start a new retro' });
      const [chooser] = await Promise.all([
        importer.waitForEvent('filechooser'),
        dialog.getByRole('button', { name: 'Import from file…' }).click()
      ]);
      await chooser.setFiles({
        name: 'ended.fastretro.json',
        mimeType: 'application/json',
        buffer: Buffer.from(guestFile)
      });
      await expect(dialog.getByRole('status', { name: 'Import preview' })).toContainText(
        /2 cards · 1 comment · 1 vote · 1 reaction · names restored/
      );
      await dialog.getByRole('button', { name: 'Import retro' }).click();
      await importer.waitForURL(/\/board\//);
      await join(importer, `importer-${suffix}`);
      const imported = cardLocator(importer, 'What went well', good);
      await expect(imported).toBeVisible({ timeout: 10_000 });
      await expect(imported.getByRole('button', { name: 'Add party reaction (1 so far)' })).toBeVisible();
      await expect(cardLocator(importer, 'Action items', action)).toBeVisible();
    } finally {
      for (const c of extra) await c.close();
      await leadCtx.close();
      await aliceCtx.close();
    }
  });

  test('an ended anonymous retro exports without names', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-ended-anon-${Date.now()}`;
    const leadName = `Lead ${Math.random().toString(36).slice(2, 6)}`;
    const text = `anonymous card ${Date.now()}`;
    const leadCtx = await browser.newContext();
    const lead = await leadCtx.newPage();
    let guestCtx: { close: () => Promise<void> } | null = null;

    try {
      await lead.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await join(lead, leadName);
      await addCard(lead, 'What went well', text);
      await lead.getByRole('button', { name: 'Turn on anonymous mode' }).click();
      await expect(lead.getByRole('button', { name: 'Turn off anonymous mode' })).toBeVisible();
      await endRetro(lead);

      const guest = await openAsGuest(browser, slug);
      guestCtx = guest.ctx;
      await expect(cardLocator(guest.page, 'What went well', text)).toBeVisible();
      const file = await saveBoardFile(guest.page);
      expect(file).not.toContain(leadName);
      const parsed = JSON.parse(file);
      expect(parsed.board.anonymous).toBe(true);
      expect(parsed.names).toBeUndefined();
      expect(parsed.cards.wentWell[0].text).toBe(text);
    } finally {
      await guestCtx?.close();
      await leadCtx.close();
    }
  });

  test('export waits until the ended board has loaded', async ({ browser }) => {
    test.setTimeout(60_000);

    const slug = `pw-ended-sync-${Date.now()}`;
    const leadCtx = await browser.newContext();
    const lead = await leadCtx.newPage();
    const guestCtx = await browser.newContext();

    try {
      await lead.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await join(lead, `Lead ${Math.random().toString(36).slice(2, 6)}`);
      await addCard(lead, 'What went well', `card ${Date.now()}`);
      await endRetro(lead);

      // Hold the board's WebSocket open without ever delivering the server's
      // state, so the board never syncs.
      const guest = await guestCtx.newPage();
      await guest.routeWebSocket(/\/ws/, () => {});
      await guest.goto(`/board/${slug}`);
      await expect(guest.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      await expect(guest.getByLabel('Your display name')).toHaveCount(0);
      await expect(guest.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
    } finally {
      await guestCtx.close();
      await leadCtx.close();
    }
  });
});
