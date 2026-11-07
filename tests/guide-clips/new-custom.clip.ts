import { expect } from '@playwright/test';
import { clickOn, clip, middleOf } from './helpers';

clip('new-custom', 'homepage', async ({ page, action, crop }) => {
  crop({ x: 0, y: 0, width: 800, height: 720 });
  const start = page.getByRole('button', { name: 'Start a new retro' });
  const onStart = await middleOf(start);
  const rest = { x: onStart.x + 60, y: onStart.y + 90 };
  await page.mouse.move(rest.x, rest.y);
  action();
  await page.waitForTimeout(300);
  await clickOn(page, rest, start, 400);

  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(350);
  await clickOn(page, onStart, dialog.getByRole('radiogroup', { name: 'Board type' }).locator('label', { hasText: 'Custom' }), 400);
  await page.waitForTimeout(250);

  const first = dialog.getByLabel('Column 1 name');
  const at = await clickOn(page, onStart, first, 400);
  await page.keyboard.type('Cut onboarding time', { delay: 35 });
  const second = dialog.getByLabel('Column 2 name');
  if ((await second.count()) === 0) await dialog.getByRole('button', { name: 'Add column' }).click();
  await clickOn(page, at, second, 300);
  await page.keyboard.type('Make deploys boring', { delay: 35 });
  await page.waitForTimeout(300);

  await clickOn(page, at, dialog.getByRole('button', { name: 'Create retro' }), 500);
  await page.waitForURL(/\/board\//);
  await expect(page.getByRole('list', { name: 'Cut onboarding time', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Make deploys boring', exact: true })).toBeVisible();
});
