import { expect } from '@playwright/test';
import { clickOn, clip } from './helpers';

clip(
  'group-merge',
  {
    layout: 'columns',
    phase: 'group',
    clusters: [{ id: 'dupes', label: 'Slow deploys' }],
    cards: {
      wentWell: [{ text: 'New hire shipped in week one' }],
      toImprove: [
        { text: 'Deploys were slow on Friday', clusterId: 'dupes' },
        { text: 'Deploy pipeline takes too long', clusterId: 'dupes' },
        { text: 'Onboarding docs are out of date' }
      ]
    }
  },
  async ({ page, action, crop }) => {
    const board = await page.getByTestId('board-columns').boundingBox();
    if (!board) throw new Error('board not on screen');
    crop({ x: board.x, y: board.y, width: board.width, height: 480 });

    const rest = { x: board.x + 400, y: board.y + 420 };
    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(400);
    const merge = page.getByRole('button', { name: 'Merge Slow deploys' }).first();
    const at = await clickOn(page, rest, merge, 700);
    await page.waitForTimeout(700);
    await clickOn(page, at, page.getByRole('alertdialog', { name: 'Confirm merge' }).getByRole('button', { name: 'Merge cards' }), 500);

    const merged = page.getByRole('group', { name: /^Card: / }).filter({ hasText: 'Deploys were slow on Friday' });
    await expect(merged).toContainText('Deploy pipeline takes too long');
    await expect(page.getByTestId('group-row')).toHaveCount(0);
  }
);
