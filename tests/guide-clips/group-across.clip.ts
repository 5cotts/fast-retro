import { expect } from '@playwright/test';
import { clip, glide, middleOf } from './helpers';

clip(
  'group-across',
  {
    layout: 'columns',
    phase: 'group',
    cards: {
      wentWell: [{ text: 'Deploy rollback saved us' }, { text: 'New hire shipped in week one' }],
      toImprove: [{ text: 'Deploys were slow on Friday' }, { text: 'Onboarding docs are out of date' }]
    }
  },
  async ({ page, action, crop }) => {
    const board = await page.getByTestId('board-columns').boundingBox();
    if (!board) throw new Error('board not on screen');
    crop({ x: board.x, y: board.y, width: board.width, height: 460 });

    const source = page.getByRole('group', { name: 'Card: Deploys were slow on Friday' });
    const target = page.getByRole('group', { name: 'Card: Deploy rollback saved us' });
    const from = await middleOf(source);
    const to = await middleOf(target);
    const rest = { x: from.x + 40, y: from.y + 170 };

    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(300);
    await glide(page, rest, from, 450);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await glide(page, from, to, 1100);
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect(page.getByRole('list', { name: /^Group: Untitled group, 2 cards/ }).first()).toBeVisible();
    await page.waitForTimeout(600);

    const name = page.getByRole('button', { name: /^Untitled group/ }).first();
    const onName = await middleOf(name);
    await glide(page, to, onName, 500);
    await page.mouse.click(onName.x, onName.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Deploys', { delay: 90 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('list', { name: /^Group: Deploys, 2 cards/ }).first()).toBeVisible();
  }
);
