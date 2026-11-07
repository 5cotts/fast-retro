import { expect } from '@playwright/test';
import { clip, glide, panTopInto, zoomInTo } from './helpers';

clip(
  'canvas-cluster',
  {
    phase: 'group',
    columns: [
      { key: 'ok', title: 'Went OK', color: 'amber' },
      { key: 'well', title: 'Went well', color: 'emerald' }
    ],
    cards: {
      ok: [
        { text: 'Deploys were slow on Friday', x: 20, y: 60 },
        { text: 'Onboarding docs are out of date', x: 20, y: 340 }
      ],
      well: [
        { text: 'Deploy rollback saved us', x: 360, y: 60 },
        { text: 'New hire shipped in week one', x: 360, y: 340 }
      ]
    }
  },
  async ({ page, card, action, crop }) => {
    await zoomInTo(page, 95);
    await panTopInto(page, card('Deploys were slow'));
    const box = await page.getByTestId('board-canvas').boundingBox();
    const moved = card('Deploy rollback');
    const target = await card('Deploys were slow').boundingBox();
    const start = await moved.boundingBox();
    if (!box || !target || !start) throw new Error('cards not on screen');
    crop(box);

    const grab = { x: start.x + start.width / 2, y: start.y + 16 };
    const drop = { x: grab.x + target.x + 20 - start.x, y: grab.y + target.y + target.height + 10 - start.y };
    const rest = { x: grab.x + 40, y: grab.y + 130 };

    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(350);
    await glide(page, rest, grab, 500);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await glide(page, grab, drop, 1400);
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(600);

    const labelAt = { x: target.x + target.width + 24, y: target.y + target.height / 2 };
    await glide(page, drop, labelAt, 600);
    await page.mouse.dblclick(labelAt.x, labelAt.y);
    await page.waitForTimeout(250);
    await page.keyboard.type('Deploys', { delay: 90 });
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('canvas-label').filter({ hasText: 'Deploys' })).toBeVisible();
    // Measured again, because the view can pan to reveal a new label.
    const after = await moved.boundingBox();
    const under = await card('Deploys were slow').boundingBox();
    expect(Math.abs(after!.y - (under!.y + under!.height + 10))).toBeLessThan(4);
  }
);
