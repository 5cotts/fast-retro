import { test, expect, type Page } from '@playwright/test';
import { boardFile, importBoard, measureLayout, resize, type Phase } from './layout-helpers';

/**
 * Board columns hold their width at any page width (BoardColumn.svelte,
 * columns.ts). With groups showing, a column is a row subgrid, and a long
 * unbroken word (a URL) used to widen its content past the column, so
 * headers and cards spilled into the next column. Zooming in is the common
 * way to get there: 125% zoom of a 1440px window is 1152px.
 *
 * Side by side, columns are at least 17rem (272px) wide; when they don't fit,
 * the board scrolls sideways and the page doesn't. On phones you swipe
 * between columns, or jump with the column chips.
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

  test('columns keep a minimum width and the board scrolls sideways', async ({ page }) => {
    test.setTimeout(60_000);
    await importBoard(page, boardFile('layout-4col.fastretro.json', 'group'));

    await resize(page, 1440);
    expect(await boardScroll(page)).toBe(0);
    await expect(page.getByTestId('board-more-right')).toHaveCount(0);

    await resize(page, 960);
    const m = await measureLayout(page);
    for (const w of m.columnWidths) expect(w).toBeGreaterThanOrEqual(272);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    expect(await boardScroll(page)).toBeGreaterThan(0);
    await expect(page.getByTestId('board-more-right')).toHaveCSS('opacity', '1');
    // The group name stays on screen at the board's left edge while scrolling.
    await page.getByTestId('board-columns').evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await expect(page.getByTestId('group-row').first().getByText('Simpler release process')).toBeInViewport({ ratio: 1 });
  });

  test('moving a card with the keyboard brings an off-screen column into view', async ({ page }) => {
    test.setTimeout(60_000);
    await importBoard(page, boardFile('layout-4col.fastretro.json', 'brainstorm'));
    await resize(page, 960);
    const card = page.getByRole('list', { name: 'How might we fix the flaky test suite?' }).getByRole('group', { name: 'Card: Docs for each team' });
    await card.focus();
    await page.keyboard.press('Shift+ArrowRight');
    const moved = page.getByRole('list', { name: 'Wildcard' }).getByRole('group', { name: 'Card: Docs for each team' });
    await expect(moved).toBeFocused();
    await expect(moved).toBeInViewport({ ratio: 1 });
  });

  // Synthetic drag events: Playwright's mouse doesn't start an HTML5 drag here.
  test('dragging a card to the board edge scrolls it', async ({ page }) => {
    test.setTimeout(60_000);
    await importBoard(page, boardFile('layout-4col.fastretro.json', 'brainstorm'));
    await resize(page, 960);
    const board = page.getByTestId('board-columns');
    const box = (await board.boundingBox())!;
    const over = page.getByRole('list', { name: 'How might we fix the flaky test suite?' });
    const card = page.getByRole('group', { name: 'Card: Shorter onboarding' });
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent('dragstart', { dataTransfer });
    for (let i = 0; i < 8; i++) {
      await over.dispatchEvent('dragover', { dataTransfer, clientX: box.x + box.width - 10, clientY: box.y + 200 });
    }
    const scrolled = await board.evaluate((el) => el.scrollLeft);
    expect(scrolled).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await over.dispatchEvent('dragover', { dataTransfer, clientX: box.x + 10, clientY: box.y + 200 });
    }
    expect(await board.evaluate((el) => el.scrollLeft)).toBeLessThan(scrolled);
    await card.dispatchEvent('dragend', { dataTransfer });
  });

  test('on a phone you swipe between columns or jump with the chips', async ({ page }) => {
    test.setTimeout(60_000);
    await importBoard(page, boardFile('layout-4col.fastretro.json', 'group'));
    await resize(page, 390, 844);
    const m = await measureLayout(page);
    expect(m.spills).toEqual([]);
    expect(m.pageOverflow).toBeLessThanOrEqual(0);
    // Each column is most of the screen, with the next one peeking in.
    for (const w of m.columnWidths) expect(w).toBe(Math.round(390 * 0.85));
    expect(await boardScroll(page)).toBeGreaterThan(0);
    await expect(page.getByTestId('group-block').first()).toBeVisible();

    const chips = page.getByRole('navigation', { name: 'Columns' });
    await expect(chips.getByRole('button')).toHaveCount(4);
    await expect(chips.getByRole('button', { name: /^How might we spend less/ })).toHaveAttribute('aria-current', 'true');
    await chips.getByRole('button', { name: 'Wildcard, 2 cards' }).click();
    await expect(page.getByRole('list', { name: 'Wildcard' })).toBeInViewport({ ratio: 0.9 });
    await expect(chips.getByRole('button', { name: 'Wildcard, 2 cards' })).toHaveAttribute('aria-current', 'true');

    // Swiping back updates the chips too.
    await page.getByTestId('board-columns').evaluate((el) => (el.scrollLeft = 0));
    await expect(chips.getByRole('button', { name: /^How might we spend less/ })).toHaveAttribute('aria-current', 'true');

    // From tablet width up there are no chips.
    await resize(page, 768);
    await expect(chips).toBeHidden();
  });
});

// How far the board's own scroller can scroll sideways.
function boardScroll(page: Page): Promise<number> {
  return page.getByTestId('board-columns').evaluate((el) => el.scrollWidth - el.clientWidth);
}
