import { test, expect, type Page } from '@playwright/test';

/**
 * End-of-retro celebration: when the lead ends the retro, every connected
 * client — not just the lead — sees a confetti burst and a motivational
 * toast live, without reloading. The broadcast rides the same Yjs `meta`
 * map already used for label/anonymous/autoSort (see setBoardEnded in
 * yboard.ts), sent before the archive REST call flips the room read-only
 * server-side. `prefers-reduced-motion` suppresses the confetti burst but
 * not the message.
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

test.describe('fast-retro end-of-retro celebration', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('ending the retro shows a live confetti + message toast on every connected client', async ({ browser }) => {
    test.setTimeout(90_000);

    const slug = `pw-end-celebration-${Date.now()}`;
    const leadCtx = await browser.newContext();
    const aliceCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    try {
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, `lead-${Date.now()}`);
      await joinAs(alicePage, `/board/${slug}`, `alice-${Date.now()}`);

      await leadPage.getByRole('button', { name: 'End retro' }).click();
      const dialog = leadPage.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Archive & end' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // Lead: confetti canvas + toast with a non-empty message.
      await expect(leadPage.locator('canvas')).toBeVisible({ timeout: 5_000 });
      const leadToast = leadPage.getByTestId('end-celebration-toast');
      await expect(leadToast).toBeVisible();
      const leadMessage = (await leadToast.textContent())?.trim() ?? '';
      expect(leadMessage.length).toBeGreaterThan(0);

      // Alice never clicked End — she should still see the same celebration
      // live, without reloading, because it's broadcast via the meta map.
      await expect(alicePage.locator('canvas')).toBeVisible({ timeout: 10_000 });
      const aliceToast = alicePage.getByTestId('end-celebration-toast');
      await expect(aliceToast).toBeVisible();
      await expect(aliceToast).toHaveText(leadMessage);

      // The persistent "ended" banner also shows live for Alice, without a
      // reload — this is the actual live-notify fix (previously participants
      // only found out on their next write getting dropped, or on reload).
      await expect(alicePage.getByText('This retro has ended')).toBeVisible();

      // Toast is dismissible.
      await leadPage.getByRole('button', { name: 'Dismiss' }).click();
      await expect(leadToast).toBeHidden();
    } finally {
      await aliceCtx.close();
      await leadCtx.close();
    }
  });

  test('prefers-reduced-motion suppresses the confetti burst but not the message', async ({ browser }) => {
    test.setTimeout(60_000);

    const slug = `pw-end-celebration-reduced-motion-${Date.now()}`;
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();

    try {
      await joinAs(page, `/lead/${LEAD_TOKEN}/${slug}`, `lead-${Date.now()}`);

      await page.getByRole('button', { name: 'End retro' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Archive & end' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      const toast = page.getByTestId('end-celebration-toast');
      await expect(toast).toBeVisible();
      await expect((await toast.textContent())?.trim()).toBeTruthy();

      // No confetti canvas should be appended.
      await expect(page.locator('canvas')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
