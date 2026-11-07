import { expect } from '@playwright/test';
import { clickOn, clip, middleOf } from './helpers';

clip(
  'run-phases',
  {
    layout: 'columns',
    phase: 'brainstorm',
    viewport: { width: 1000, height: 720 },
    showsHeader: true,
    cards: { wentWell: [{ text: 'Deploy rollback saved us' }], toImprove: [{ text: 'Deploys were slow on Friday' }] }
  },
  async ({ page, action, crop }) => {
    crop({ x: 0, y: 0, width: 1000, height: 500 });
    const pill = page.locator('[title="Timer controls"]').first();
    const onPill = await middleOf(pill);
    const rest = { x: onPill.x - 80, y: onPill.y + 260 };
    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(300);
    await clickOn(page, rest, pill, 500);

    const timer = page.getByRole('dialog', { name: 'Timer controls' });
    await expect(timer).toBeVisible();
    await page.waitForTimeout(250);
    const minutes = timer.getByLabel('Timer minutes');
    await minutes.fill('');
    let at = await clickOn(page, onPill, minutes, 300);
    await page.keyboard.type('10', { delay: 120 });
    at = await clickOn(page, at, timer.getByRole('button', { name: 'Set', exact: true }), 300);
    at = await clickOn(page, at, timer.getByRole('button', { name: 'Start timer' }), 300);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);

    await clickOn(page, at, page.getByRole('button', { name: 'Advance to Group phase' }), 800);
    await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: 'Group' })).toBeVisible();
  }
);
