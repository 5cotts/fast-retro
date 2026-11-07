import { expect } from '@playwright/test';
import { clip, glide, panTopInto, zoomInTo } from './helpers';

clip(
  'canvas-add',
  {
    phase: 'brainstorm',
    columns: [
      { key: 'ok', title: 'Went OK', color: 'amber' },
      { key: 'well', title: 'Went well', color: 'emerald' }
    ],
    cards: {
      ok: [{ text: 'Deploys were slow on Friday', x: 20, y: 60 }],
      well: [{ text: 'Deploy rollback saved us', x: 360, y: 60 }]
    }
  },
  async ({ page, card, action, crop }) => {
    await zoomInTo(page, 95);
    await panTopInto(page, card('Deploy rollback'));
    const composer = page.getByTestId('canvas-composer');
    const canvas = await page.getByTestId('board-canvas').boundingBox();
    const bar = await composer.boundingBox();
    const seeded = await card('Deploy rollback').boundingBox();
    if (!canvas || !bar || !seeded) throw new Error('board not on screen');
    crop({ x: canvas.x, y: canvas.y, width: canvas.width, height: bar.y + bar.height - canvas.y });

    const input = page.getByLabel('Add a card to Went OK');
    const inputBox = await input.boundingBox();
    if (!inputBox) throw new Error('composer not on screen');
    const rest = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    const inInput = { x: inputBox.x + 60, y: inputBox.y + inputBox.height / 2 };

    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(300);
    await glide(page, rest, inInput, 500);
    await page.mouse.click(inInput.x, inInput.y);
    await page.waitForTimeout(150);
    await page.keyboard.type('Standups ran long', { delay: 60 });
    await page.keyboard.press('Enter');
    await expect(card('Standups ran long')).toBeVisible();
    await page.waitForTimeout(700);

    const spot = { x: seeded.x + 40, y: seeded.y + seeded.height + 50 };
    await glide(page, inInput, spot, 700);
    await page.waitForTimeout(150);
    await page.mouse.dblclick(spot.x, spot.y);
    await page.waitForTimeout(250);
    await page.keyboard.type('Pairing helped', { delay: 60 });
    await page.keyboard.press('Enter');

    const placed = await card('Pairing helped').boundingBox();
    expect(Math.abs(placed!.y - spot.y)).toBeLessThan(60);
  }
);
