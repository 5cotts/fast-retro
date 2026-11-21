import { expect } from '@playwright/test';
import { clip, glide, panTopInto, zoomInTo } from './helpers';

clip(
  'canvas-group',
  {
    phase: 'group',
    columns: [
      { key: 'ok', title: 'Went OK', color: 'amber' },
      { key: 'well', title: 'Went well', color: 'emerald' }
    ],
    cards: {
      ok: [
        { text: 'Deploys were slow on Friday', x: 20, y: 60 },
        { text: 'Onboarding docs are out of date', x: 20, y: 400 }
      ],
      well: [
        { text: 'Deploy rollback saved us', x: 360, y: 60 },
        { text: 'New hire shipped in week one', x: 360, y: 400 }
      ]
    }
  },
  async ({ page, card, action, crop }) => {
    await zoomInTo(page, 80);
    await panTopInto(page, card('Deploys were slow'));
    const box = await page.getByTestId('board-canvas').boundingBox();
    if (!box) throw new Error('canvas not on screen');
    crop(box);

    const centerTop = async (text: string) => {
      const b = await card(text).boundingBox();
      if (!b) throw new Error(`${text} not on screen`);
      return { x: b.x + b.width / 2, y: b.y + 16 };
    };

    const rest = { x: box.x + box.width / 2, y: box.y + box.height - 60 };
    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(350);

    // A card dropped on another one makes a group.
    const from = await centerTop('Deploy rollback');
    const onto = await centerTop('Deploys were slow');
    await glide(page, rest, from, 500);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await glide(page, from, onto, 1200);
    await page.waitForTimeout(500);
    await page.mouse.up();
    const group = page.getByTestId('canvas-group');
    await expect(group).toHaveCount(1);
    await page.waitForTimeout(500);

    // Name it.
    await page.getByRole('heading', { name: 'Untitled group' }).click();
    await page.keyboard.type('Deploys', { delay: 90 });
    await page.keyboard.press('Enter');
    await expect(group).toContainText('Deploys');
    await page.waitForTimeout(300);

    // A third card joins by dropping on the box.
    const third = await centerTop('Onboarding docs');
    const inside = await group.boundingBox();
    if (!inside) throw new Error('group not on screen');
    const drop = { x: inside.x + inside.width / 2, y: inside.y + inside.height / 2 };
    await glide(page, onto, third, 600);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await glide(page, third, drop, 1100);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(group).toContainText('3 cards');
  }
);
