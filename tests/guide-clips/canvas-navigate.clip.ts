import { expect } from '@playwright/test';
import { clip, glide } from './helpers';

const zoomOf = (text: string | null) => Number((text ?? '').replace('%', ''));

clip(
  'canvas-navigate',
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
  async ({ page, action, crop }) => {
    const box = await page.getByTestId('board-canvas').boundingBox();
    if (!box) throw new Error('canvas not on screen');
    crop(box);
    const world = page.getByTestId('canvas-world');
    const transform = () => world.evaluate((n) => (n as HTMLElement).style.transform);
    const zoom = page.getByTestId('canvas-zoom');
    const fitted = await zoom.textContent();

    // Empty space near the bottom-left corner, away from the cards.
    const grab = { x: box.x + 30, y: box.y + box.height - 90 };
    const panned = { x: grab.x + 110, y: grab.y - 70 };
    await page.mouse.move(grab.x + 60, grab.y - 60);
    action();
    await page.waitForTimeout(300);
    await glide(page, { x: grab.x + 60, y: grab.y - 60 }, grab, 350);

    const before = await transform();
    await page.mouse.down();
    await glide(page, grab, panned, 900);
    await page.mouse.up();
    await expect.poll(transform).not.toBe(before);
    await page.waitForTimeout(350);

    const onCard = await page.getByTestId('canvas-card').filter({ hasText: 'Onboarding' }).boundingBox();
    if (!onCard) throw new Error('card not on screen');
    const zoomInAt = { x: onCard.x + onCard.width / 2, y: onCard.y + onCard.height / 2 };
    await glide(page, panned, zoomInAt, 450);
    await page.keyboard.down('Control');
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -12);
      await page.waitForTimeout(90);
    }
    await page.keyboard.up('Control');
    await expect.poll(async () => zoomOf(await zoom.textContent())).toBeGreaterThan(zoomOf(fitted));
    await page.waitForTimeout(450);

    const fit = page.getByRole('button', { name: 'Fit' });
    const fitBox = await fit.boundingBox();
    if (!fitBox) throw new Error('Fit not on screen');
    const onFit = { x: fitBox.x + fitBox.width / 2, y: fitBox.y + fitBox.height / 2 };
    await glide(page, zoomInAt, onFit, 600);
    await page.waitForTimeout(150);
    await page.mouse.click(onFit.x, onFit.y);
    await expect(zoom).toHaveText(fitted ?? '');
  }
);
