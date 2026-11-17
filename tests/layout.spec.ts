import { test, expect } from '@playwright/test';
import { boardFile, importBoard, measureLayout, resize, type Phase } from './layout-helpers';

/**
 * Board columns hold their width at any page width (BoardColumn.svelte,
 * columns.ts). With groups showing, a column is a row subgrid, and a long
 * unbroken word (a URL) used to widen its content past the column, so
 * headers and cards spilled into the next column. Zooming in is the common
 * way to get there: 125% zoom of a 1440px window is 1152px.
 *
 * The fixture has two groups, a card with a long URL and one long word.
 */
const WIDTHS = [1440, 1152, 960, 768];
const PHASES: Phase[] = ['brainstorm', 'group', 'vote', 'discuss'];

test.describe('board layout', () => {
  for (const phase of PHASES) {
    test(`four columns in ${phase} stay inside their tracks`, async ({ page }) => {
      test.setTimeout(60_000);
      await importBoard(page, boardFile('layout-4col.fastretro.json', phase));
      for (const width of WIDTHS) {
        await resize(page, width);
        await expect(page.getByTestId('group-row')).toHaveCount(phase === 'brainstorm' ? 0 : 2);
        const m = await measureLayout(page);
        expect(m.spills, `${phase} at ${width}px`).toEqual([]);
        expect(m.pageOverflow, `${phase} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('six columns with groups stay inside their tracks', async ({ page }) => {
    test.setTimeout(60_000);
    await importBoard(page, boardFile('layout-6col.fastretro.json', 'group'));
    for (const width of WIDTHS) {
      await resize(page, width);
      await expect(page.getByTestId('group-row')).toHaveCount(1);
      const m = await measureLayout(page);
      expect(m.spills, `at ${width}px`).toEqual([]);
      expect(m.pageOverflow, `at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});
