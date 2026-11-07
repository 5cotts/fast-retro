import { expect } from '@playwright/test';
import { clickOn, clip, middleOf } from './helpers';

clip(
  'edit-board',
  {
    layout: 'columns',
    phase: 'brainstorm',
    viewport: { width: 800, height: 820 },
    showsHeader: true,
    columns: [
      { key: 'onboarding', title: 'Cut onboarding time', color: 'emerald' },
      { key: 'deploys', title: 'Make deploys boring', color: 'amber' }
    ],
    cards: { onboarding: [{ text: 'Buddy for week one' }], deploys: [{ text: 'One-click rollback' }] }
  },
  async ({ page, action, crop }) => {
    crop({ x: 0, y: 0, width: 800, height: 820 });
    const gear = page.getByRole('button', { name: 'Edit board' }).first();
    const onGear = await middleOf(gear);
    const rest = { x: onGear.x - 40, y: onGear.y + 220 };
    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(300);
    await clickOn(page, rest, gear, 500);

    const dialog = page.getByRole('dialog', { name: 'Edit board' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    const add = dialog.getByRole('button', { name: 'Add column' });
    const onAdd = await clickOn(page, onGear, add, 500);
    await page.waitForTimeout(150);
    const rows = await dialog.getByRole('textbox', { name: /^Column \d+ name$/ }).count();
    const fresh = dialog.getByLabel(`Column ${rows} name`);
    await fresh.focus();
    await page.keyboard.type('Reduce on-call', { delay: 45 });
    await page.waitForTimeout(250);

    const at = await clickOn(page, onAdd, dialog.getByRole('button', { name: `Move column ${rows} up` }), 400);
    await page.waitForTimeout(450);
    await clickOn(page, at, dialog.getByRole('button', { name: 'Save', exact: true }), 500);

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('list', { name: 'Reduce on-call', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Card: One-click rollback' })).toBeVisible();
  }
);
