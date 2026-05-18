import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Full retro session: one lead and two engineers walk through every
 * phase (Brainstorm → Group → Vote → Discuss → Actions), exercising
 * core actions in each — card add, vote, react, comment, timer
 * broadcast, and end-board confirm/cancel.
 *
 * Requires the lead token for the target deployment. By default this
 * test is skipped; set RETRO_LEAD_TOKEN in the environment to run it:
 *
 *   RETRO_LEAD_TOKEN=… bun run test:e2e
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
  await expect(column.getByRole('group', { name: `Card: ${text}` })).toBeVisible();
}

function cardLocator(page: Page, columnTitle: string, text: string) {
  return page
    .getByRole('list', { name: columnTitle })
    .getByRole('group', { name: `Card: ${text}` });
}

async function expectActivePhase(pages: Page[], label: string) {
  for (const p of pages) {
    await expect(
      p.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })
    ).toBeVisible({ timeout: 10_000 });
  }
}

async function advancePhase(leadPage: Page, nextLabel: string) {
  await leadPage
    .getByRole('button', { name: `Advance to ${nextLabel} phase` })
    .click();
}

test.describe('fast-retro full session', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set to run the full-session test');

  test('lead + two engineers walk through all five phases', async ({ browser }) => {
    test.setTimeout(120_000);

    const slug = `pw-session-${Date.now()}`;
    const leadName = `lead-${Math.random().toString(36).slice(2, 6)}`;
    const aliceName = `alice-${Math.random().toString(36).slice(2, 6)}`;
    const bobName = `bob-${Math.random().toString(36).slice(2, 6)}`;

    const leadCtx: BrowserContext = await browser.newContext();
    const aliceCtx: BrowserContext = await browser.newContext();
    const bobCtx: BrowserContext = await browser.newContext();

    const leadPage = await leadCtx.newPage();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();
    const allPages = [leadPage, alicePage, bobPage];

    try {
      // --- Everyone joins ---
      await joinAs(leadPage, `/lead/${LEAD_TOKEN}/${slug}`, leadName);
      await joinAs(alicePage, `/board/${slug}`, aliceName);
      await joinAs(bobPage, `/board/${slug}`, bobName);

      // Host pill should only appear in the lead context.
      await expect(leadPage.getByText('Host', { exact: true })).toBeVisible();
      await expect(alicePage.getByText('Host', { exact: true })).toBeHidden();

      // Presence: every page should show every other participant's name.
      for (const p of allPages) {
        for (const n of [leadName, aliceName, bobName]) {
          await expect(p.locator('body')).toContainText(n, { timeout: 10_000 });
        }
      }

      // We start in Brainstorm.
      await expectActivePhase(allPages, 'Brainstorm');

      // --- Phase 1: Brainstorm — engineers add cards ---
      const aliceWentWell = `alice ww ${Date.now()}`;
      const aliceImprove = `alice imp ${Date.now()}`;
      const bobWentWell = `bob ww ${Date.now()}`;
      const bobImprove = `bob imp ${Date.now()}`;

      await addCard(alicePage, 'What went well', aliceWentWell);
      await addCard(alicePage, 'What to improve', aliceImprove);
      await addCard(bobPage, 'What went well', bobWentWell);
      await addCard(bobPage, 'What to improve', bobImprove);

      // Every page should see every card (CRDT replication).
      for (const p of allPages) {
        await expect(cardLocator(p, 'What went well', aliceWentWell)).toBeVisible({
          timeout: 10_000
        });
        await expect(cardLocator(p, 'What went well', bobWentWell)).toBeVisible({
          timeout: 10_000
        });
        await expect(cardLocator(p, 'What to improve', aliceImprove)).toBeVisible({
          timeout: 10_000
        });
        await expect(cardLocator(p, 'What to improve', bobImprove)).toBeVisible({
          timeout: 10_000
        });
      }

      // --- Lead starts a short timer; engineers should see the timer pill ---
      // The timer trigger is in the lead toolbar; identify it by its dialog
      // target (it has aria-haspopup="dialog" + title="Timer controls").
      await leadPage.locator('[title="Timer controls"]').first().click();
      const timerDialog = leadPage.getByRole('dialog', { name: 'Timer controls' });
      await expect(timerDialog).toBeVisible();
      await timerDialog.getByLabel('Timer minutes').fill('2');
      await timerDialog.getByRole('button', { name: 'Set', exact: true }).click();
      await timerDialog.getByRole('button', { name: 'Start timer' }).click();
      // Engineers see a running timer pill.
      for (const p of [alicePage, bobPage]) {
        await expect(p.getByRole('timer')).toBeVisible({ timeout: 5_000 });
      }
      // Close popover by clicking elsewhere so it doesn't intercept later clicks.
      await leadPage.keyboard.press('Escape');

      // --- Advance: Brainstorm → Group ---
      await advancePhase(leadPage, 'Group');
      await expectActivePhase(allPages, 'Group');

      // Gating: once we've left Brainstorm, the input columns no longer
      // accept new cards. The textarea is replaced with an inline notice.
      for (const p of allPages) {
        await expect(p.getByLabel('Add a card to What went well')).toBeHidden();
        await expect(p.getByLabel('Add a card to What to improve')).toBeHidden();
      }

      // --- Lead bumps back to Brainstorm using the Previous button ---
      // (rehearsing the "facilitator misclicked Next" recovery flow.)
      await leadPage
        .getByRole('button', { name: 'Go back to Brainstorm phase' })
        .click();
      await expectActivePhase(allPages, 'Brainstorm');
      // Card-entry UI returns.
      for (const p of allPages) {
        await expect(p.getByLabel('Add a card to What went well')).toBeVisible();
      }
      // Forward again: Brainstorm → Group → Vote.
      await advancePhase(leadPage, 'Group');
      await expectActivePhase(allPages, 'Group');
      await advancePhase(leadPage, 'Vote');
      await expectActivePhase(allPages, 'Vote');

      // --- Phase 3: Vote — both engineers upvote alice's "went well" card ---
      for (const p of [alicePage, bobPage]) {
        await cardLocator(p, 'What went well', aliceWentWell)
          .getByRole('button', { name: /^Upvote/ })
          .click();
      }

      // Each engineer should see their own "Remove vote (2)" state once both
      // votes have propagated.
      for (const p of [alicePage, bobPage]) {
        await expect(
          cardLocator(p, 'What went well', aliceWentWell).getByRole('button', {
            name: /Remove vote \(2\)/
          })
        ).toBeVisible({ timeout: 10_000 });
      }
      // Lead never voted — they see "Upvote (2)".
      await expect(
        cardLocator(leadPage, 'What went well', aliceWentWell).getByRole('button', {
          name: /Upvote \(2\)/
        })
      ).toBeVisible({ timeout: 10_000 });

      // --- Advance: Vote → Discuss ---
      await advancePhase(leadPage, 'Discuss');
      await expectActivePhase(allPages, 'Discuss');

      // Gating: voting is closed in Discuss. Bob hasn't voted on his own
      // "improve" card, so its upvote button must be disabled. Counts on
      // already-voted cards are still mutable so people can un-do mistakes.
      await expect(
        cardLocator(bobPage, 'What to improve', bobImprove).getByRole('button', {
          name: /Voting closed/
        })
      ).toBeDisabled();

      // --- Phase 4: Discuss — alice reacts, bob comments ---
      {
        const card = cardLocator(alicePage, 'What to improve', bobImprove);
        await card.getByRole('button', { name: 'Add a reaction', exact: true }).click();
        await card.getByRole('menu').getByRole('menuitem', { name: 'React with party' }).click();
        await expect(
          card.getByRole('button', { name: /Remove your party reaction \(1/ })
        ).toBeVisible();
      }
      {
        const card = cardLocator(bobPage, 'What went well', aliceWentWell);
        await card.getByRole('button', { name: /Comments/ }).click();
        const commentText = `discuss this ${Math.random().toString(36).slice(2, 6)}`;
        const commentInput = card.getByPlaceholder('Add a comment…');
        await commentInput.fill(commentText);
        await card.getByRole('button', { name: 'Post' }).click();
        await expect(card.getByText(commentText)).toBeVisible();
        // The lead's view of the same card should reflect the comment count.
        await expect(
          cardLocator(leadPage, 'What went well', aliceWentWell).getByRole('button', {
            name: /Comments \(1\)/
          })
        ).toBeVisible({ timeout: 10_000 });
      }

      // --- Advance: Discuss → Actions ---
      await advancePhase(leadPage, 'Actions');
      await expectActivePhase(allPages, 'Actions');

      // No further "Next phase" button on the last phase.
      await expect(
        leadPage.getByRole('button', { name: /Advance to .* phase/ })
      ).toBeHidden();

      // --- Phase 5: Actions — alice records an action item ---
      const actionText = `ship the thing ${Date.now()}`;
      await addCard(alicePage, 'Action items', actionText);
      for (const p of allPages) {
        await expect(cardLocator(p, 'Action items', actionText)).toBeVisible({
          timeout: 10_000
        });
      }

      // --- End-board confirm flow: open the alertdialog, then cancel ---
      // (We don't actually clear because that would wipe shared state mid-test.)
      await leadPage.getByRole('button', { name: 'End retro' }).click();
      const endDialog = leadPage.getByRole('alertdialog');
      await expect(endDialog).toBeVisible();
      await expect(endDialog).toContainText('End this retro?');
      await endDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(endDialog).toBeHidden();
    } finally {
      await leadCtx.close();
      await aliceCtx.close();
      await bobCtx.close();
    }
  });
});
