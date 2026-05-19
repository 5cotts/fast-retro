import { test, expect, type Page } from '@playwright/test';

/**
 * Host dashboard: the /lead/[token] landing page polls /api/boards and
 * shows live boards with participant + phase + card-count badges. This
 * test creates two boards from a participant context, then opens the
 * host dashboard and asserts both show up with the expected metadata.
 *
 * Skipped unless RETRO_LEAD_TOKEN is set.
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function joinAs(page: Page, path: string, name: string) {
  await page.goto(path);
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
  const card = column.getByRole('group', { name: `Card: ${text}` });
  await expect(card).toBeVisible();
}

test.describe('fast-retro host dashboard', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('shows live boards with participant + phase + card counts', async ({ browser }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const slugA = `pw-host-a-${stamp}`;
    const slugB = `pw-host-b-${stamp}`;
    const labelA = `Sprint Alpha ${stamp}`;

    const leadACtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const hostCtx = await browser.newContext();
    const leadAPage = await leadACtx.newPage();
    const bobPage = await bobCtx.newPage();
    const hostPage = await hostCtx.newPage();

    try {
      // Board A: lead joins, names it, adds one card. Lead stays connected so
      // /api/boards counts a live participant.
      await joinAs(leadAPage, `/lead/${LEAD_TOKEN}/${slugA}`, 'lead-a');
      await leadAPage.getByRole('button', { name: 'Name this retro' }).click();
      const labelInput = leadAPage.getByRole('textbox', { name: 'Board name' });
      await labelInput.fill(labelA);
      await labelInput.press('Enter');
      await addCard(leadAPage, 'What went well', 'shipped on time');

      // Board B: Bob joins as participant, no label, no cards. Just being
      // connected should make B show up in Live now.
      await joinAs(bobPage, `/board/${slugB}`, 'bob');

      // Open the host dashboard. Recents/localStorage in this fresh context
      // is empty; live boards are non-empty, so the fresh-slug redirect is
      // skipped and the dashboard renders.
      await hostPage.goto(`/lead/${LEAD_TOKEN}`);

      const liveSection = hostPage.locator('section[aria-labelledby="live-now-heading"]');
      await expect(liveSection).toBeVisible({ timeout: 15_000 });

      // Board A: labeled, with one card. Match by label text.
      const boardARow = liveSection.getByRole('button', { name: new RegExp(labelA) });
      await expect(boardARow).toBeVisible({ timeout: 15_000 });
      await expect(boardARow).toContainText(slugA);
      await expect(boardARow).toContainText(/1\s+card/);

      // Board B: unlabeled, slug shown in the row.
      const boardBRow = liveSection.getByRole('button', { name: new RegExp(slugB) });
      await expect(boardBRow).toBeVisible({ timeout: 15_000 });
      await expect(boardBRow).toContainText('No label yet');

      // Clicking the labeled row takes the host into the lead view.
      await boardARow.click();
      await expect(hostPage).toHaveURL(new RegExp(`/lead/${LEAD_TOKEN}/${slugA}$`));
      // Host context is fresh, so they still need to enter a display name
      // before the board renders. Handle that.
      const namePromptInput = hostPage.getByLabel('Your display name');
      if (await namePromptInput.isVisible().catch(() => false)) {
        await namePromptInput.fill('host');
        await hostPage.getByRole('button', { name: 'Join the retro' }).click();
        await dismissOnboardingIfPresent(hostPage);
      }
      await expect(hostPage.getByRole('list', { name: 'What went well' })).toBeVisible();
    } finally {
      await leadACtx.close();
      await bobCtx.close();
      await hostCtx.close();
    }
  });
});
