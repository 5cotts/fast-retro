import { test, expect, type Page } from '@playwright/test';

/**
 * Anonymous mode: the lead toggles a board-wide flag that hides the
 * author byline on cards and comments from everyone except the author
 * themselves. The lead sees their own card labelled "you (hidden)";
 * a participant viewing the same card sees "Anonymous".
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

test.describe('fast-retro anonymous mode', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('lead toggle hides author byline from other participants', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-anon-${Date.now()}`;
    const leadName = `lead-${Math.random().toString(36).slice(2, 6)}`;
    const aliceName = `alice-${Math.random().toString(36).slice(2, 6)}`;
    const cardText = `private observation ${Date.now()}`;

    const leadCtx = await browser.newContext();
    const aliceCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    try {
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, leadName);
      await joinAs(alicePage, `/board/${slug}`, aliceName);

      // Lead drops a card. Anonymous mode is off, so Alice should see
      // the lead's name on the byline.
      const leadDraft = leadPage.getByLabel('Add a card to What went well');
      await leadDraft.click();
      await leadDraft.fill(cardText);
      const leadColumn = leadPage.getByRole('list', { name: 'What went well' });
      await leadColumn.getByRole('button', { name: 'Add card', exact: true }).click();

      const aliceCard = alicePage
        .getByRole('list', { name: 'What went well' })
        .getByRole('group', { name: `Card: ${cardText}` });
      await expect(aliceCard).toBeVisible({ timeout: 10_000 });
      // Lead's name should appear as the byline before anonymous is on.
      await expect(aliceCard).toContainText(leadName);

      // Anonymous badge should be absent on both pages while mode is off.
      await expect(leadPage.getByLabel('Anonymous mode on')).toBeHidden();
      await expect(alicePage.getByLabel('Anonymous mode on')).toBeHidden();

      // Lead turns anonymous mode ON.
      await leadPage.getByRole('button', { name: 'Turn on anonymous mode' }).click();
      await expect(leadPage.getByRole('button', { name: 'Turn off anonymous mode' })).toBeVisible();

      // Anonymous badge propagates via the CRDT to every connected page.
      await expect(leadPage.getByLabel('Anonymous mode on')).toBeVisible({ timeout: 10_000 });
      await expect(alicePage.getByLabel('Anonymous mode on')).toBeVisible({ timeout: 10_000 });

      // Lead still sees their own card as "you (hidden)".
      const leadCard = leadPage
        .getByRole('list', { name: 'What went well' })
        .getByRole('group', { name: `Card: ${cardText}` });
      await expect(leadCard).toContainText('you (hidden)');

      // Alice — a different participant — should no longer see the lead's
      // name on the byline; she should see "Anonymous" instead.
      await expect(aliceCard).toContainText('Anonymous', { timeout: 10_000 });
      await expect(aliceCard).not.toContainText(leadName);

      // Toggle back off — Alice should see the lead's name return.
      await leadPage.getByRole('button', { name: 'Turn off anonymous mode' }).click();
      await expect(alicePage.getByLabel('Anonymous mode on')).toBeHidden({ timeout: 10_000 });
      await expect(aliceCard).toContainText(leadName);
    } finally {
      await aliceCtx.close();
      await leadCtx.close();
    }
  });
});
