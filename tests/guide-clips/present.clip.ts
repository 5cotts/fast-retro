import { expect } from '@playwright/test';
import { clickOn, clip, glide, middleOf } from './helpers';

const MINE = 'Standups ran long';

clip(
  'present',
  {
    layout: 'columns',
    phase: 'brainstorm',
    viewport: { width: 1000, height: 720 },
    showsHeader: true,
    cards: {
      wentWell: [{ text: 'Pairing on the release' }, { text: 'Fast code reviews' }],
      toImprove: [{ text: 'Flaky tests on CI' }]
    }
  },
  async ({ page, action, crop }) => {
    // Before the clip: the host writes a card and votes for it, so their
    // screen marks both as theirs.
    const draft = page.getByLabel('Add a card to What to improve', { exact: true });
    await draft.fill(MINE);
    await draft.press('Enter');
    const mine = page.getByRole('group', { name: `Card: ${MINE}` });
    await expect(mine).toBeVisible();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /^Advance to / }).click();
    await mine.getByRole('button', { name: /^Upvote/ }).click();
    await expect(mine.getByRole('button', { name: 'Remove vote (1)' })).toHaveAttribute('aria-pressed', 'true');

    crop({ x: 0, y: 0, width: 1000, height: 440 });
    const trigger = page.getByRole('button', { name: 'Present', exact: true }).and(page.locator('[aria-haspopup="menu"]'));
    const onMine = await middleOf(mine);
    await page.mouse.move(onMine.x, onMine.y);
    action();
    await page.waitForTimeout(900);
    let at = await clickOn(page, onMine, trigger, 600);
    const inTab = page.getByRole('menuitem', { name: /^Present in this tab/ });
    await expect(inTab).toBeVisible();
    await page.waitForTimeout(500);
    at = await clickOn(page, at, inTab, 400);
    await expect(page.getByTestId('presenting-pill')).toBeVisible();
    await expect(mine.getByRole('button', { name: /^Voting paused while you present/ })).toHaveAttribute('aria-pressed', 'false');
    await glide(page, at, onMine, 600);
  }
);
