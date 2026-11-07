import { expect } from '@playwright/test';
import { clickOn, clip, guestAddsCards, middleOf } from './helpers';

const COLUMNS = [
  { key: 'onboarding', title: 'Cut onboarding time', color: 'emerald' },
  { key: 'deploys', title: 'Make deploys boring', color: 'amber' }
];

clip(
  'hide-reveal',
  {
    layout: 'columns',
    phase: 'brainstorm',
    columns: COLUMNS,
    hideCards: true,
    cards: {},
    prepare: (browser, url) =>
      guestAddsCards(browser, url, [
        { column: 'Cut onboarding time', text: 'Buddy for week one' },
        { column: 'Make deploys boring', text: 'Deploy every morning' },
        { column: 'Make deploys boring', text: 'One-click rollback' }
      ])
  },
  async ({ page, action, crop }) => {
    await expect(page.getByTestId('hidden-card')).toHaveCount(3);
    const bar = await page.getByLabel('Retro phase').boundingBox();
    if (!bar) throw new Error('phase bar not on screen');
    crop({ x: bar.x, y: bar.y, width: bar.width, height: 500 });

    const draft = page.getByLabel('Add a card to Cut onboarding time', { exact: true });
    const onDraft = await middleOf(draft);
    const rest = { x: onDraft.x + 60, y: onDraft.y + 200 };
    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(500);
    await clickOn(page, rest, draft);
    await page.keyboard.type('Pair on first PR', { delay: 55 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: 'Card: Pair on first PR' })).toBeVisible();
    await page.waitForTimeout(800);

    await clickOn(page, onDraft, page.getByRole('button', { name: 'Advance to Group phase' }), 700);
    await expect(page.getByRole('group', { name: 'Card: One-click rollback' })).toBeVisible();
    await expect(page.getByTestId('hidden-card')).toHaveCount(0);
  }
);
