import { readFileSync } from 'node:fs';
import { test, expect, type Download, type Page } from '@playwright/test';

/**
 * Download JSON (frontend/src/lib/boardfile.ts): the live board export, the
 * End retro "Download JSON & end" path, and the archive viewer's export.
 * Covers the privacy rule that anonymous boards never put names in the file.
 *
 * Skipped unless RETRO_LEAD_TOKEN is set (uses the lead route and archives).
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function readJSON(download: Download) {
  expect(download.suggestedFilename()).toMatch(/\.fastretro\.json$/);
  const path = await download.path();
  return JSON.parse(readFileSync(path as string, 'utf-8'));
}

test.describe('fast-retro JSON export', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('exports the full board, hides names when anonymous, and exports archives', async ({
    browser
  }) => {
    test.setTimeout(90_000);

    const slug = `pw-json-export-${Date.now()}`;
    const leadName = `Lead ${Math.random().toString(36).slice(2, 6)}`;
    const cardText = `exported "card", with emoji 🎉 ${Date.now()}`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await page.goto(`/lead/${LEAD_TOKEN}/${slug}`);
      await page.getByLabel('Your display name').fill(leadName);
      await page.getByRole('button', { name: 'Join the retro' }).click();
      await dismissOnboardingIfPresent(page);

      const draft = page.getByLabel('Add a card to What went well');
      await draft.click();
      await draft.fill(cardText);
      const wentWell = page.getByRole('list', { name: 'What went well' });
      await wentWell.getByRole('button', { name: 'Add card', exact: true }).click();
      const cardEl = wentWell.getByRole('group', { name: /^Card: exported/ });
      await expect(cardEl).toBeVisible();

      await page.getByRole('button', { name: 'Advance to Group phase' }).click();
      await page.getByRole('button', { name: 'Advance to Vote phase' }).click();
      await cardEl.getByRole('button', { name: /^Upvote/ }).click();
      await expect(cardEl.getByRole('button', { name: /^Remove vote \(1\)/ })).toBeVisible();

      // Named board: names are included, but only for people on the board.
      const [named] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download JSON' }).click()
      ]);
      const namedFile = await readJSON(named);
      expect(namedFile.format).toBe('fast-retro');
      expect(namedFile.version).toBe(1);
      expect(namedFile.board).toMatchObject({ anonymous: false, phase: 'vote', autoSort: true });
      expect(namedFile.cards.wentWell).toHaveLength(1);
      const exported = namedFile.cards.wentWell[0];
      expect(exported.text).toBe(cardText);
      expect(exported.votes).toEqual([exported.authorId]);
      expect(namedFile.names).toEqual({ [exported.authorId]: leadName });

      // Anonymous board: no names anywhere in the file.
      await page.getByRole('button', { name: 'Turn on anonymous mode' }).click();
      await expect(page.getByRole('button', { name: 'Turn off anonymous mode' })).toBeVisible();
      const [anon] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download JSON' }).click()
      ]);
      const anonPath = await anon.path();
      const anonText = readFileSync(anonPath as string, 'utf-8');
      expect(anonText).not.toContain(leadName);
      expect(JSON.parse(anonText).board.anonymous).toBe(true);
      expect(JSON.parse(anonText).names).toBeUndefined();

      // End retro with export-first downloads the JSON file.
      await page.getByRole('button', { name: 'End retro' }).click();
      const dialog = page.getByRole('alertdialog');
      const [onEnd] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Download JSON & end' }).click()
      ]);
      expect((await readJSON(onEnd)).cards.wentWell[0].text).toBe(cardText);
      await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });

      // The archive records the flags and the viewer exports the same shape.
      await page.goto(`/lead/${LEAD_TOKEN}/archives`);
      const item = page.getByTestId('archive-item').filter({ hasText: slug }).first();
      await expect(item).toBeVisible({ timeout: 10_000 });
      await item.getByRole('link').first().click();
      await expect(page.getByTestId('archive-card').filter({ hasText: 'exported' })).toBeVisible();
      const [fromArchive] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download JSON' }).click()
      ]);
      const archived = await readJSON(fromArchive);
      expect(archived.board).toMatchObject({ anonymous: true, phase: 'vote', autoSort: true });
      expect(archived.names).toBeUndefined();
      expect(archived.cards.wentWell[0].text).toBe(cardText);
      expect(archived.cards.wentWell[0].votes).toHaveLength(1);
      await expect(page.getByText(leadName)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
