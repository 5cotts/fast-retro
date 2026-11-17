import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

// Shared by the layout specs: import a board file through the homepage and
// measure whether anything in a board column pokes out of it.

export type Phase = 'brainstorm' | 'group' | 'vote' | 'discuss';

export function boardFile(name: string, phase: Phase) {
  const file = JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf-8'));
  file.board.phase = phase;
  file.board.label = `${file.board.label} (${phase})`;
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) };
}

export async function importBoard(page: Page, file: ReturnType<typeof boardFile>) {
  await page.addInitScript(() => {
    localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog.getByRole('button', { name: 'Import from file…' }).click()
  ]);
  await chooser.setFiles(file);
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Layout tester');
  await page.getByRole('button', { name: 'Join the retro' }).click();
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(page.getByTestId('board-columns')).toBeVisible();
}

export async function resize(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export interface LayoutReport {
  // How far the page itself scrolls sideways. The board's own scroller doesn't count.
  pageOverflow: number;
  columnWidths: number[];
  // Anything inside a column that sticks out of it, worst first.
  spills: { column: number; px: number; what: string }[];
}

export function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const sections = [...document.querySelectorAll<HTMLElement>('[data-testid=board-columns] > section')];
    const spills: { column: number; px: number; what: string }[] = [];
    sections.forEach((section, column) => {
      const box = section.getBoundingClientRect();
      for (const el of section.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 1) continue;
        const px = Math.max(r.right - box.right, box.left - r.left);
        if (px > 1) spills.push({ column, px: Math.round(px), what: (el.getAttribute('aria-label') ?? el.tagName).slice(0, 60) });
      }
    });
    spills.sort((a, b) => b.px - a.px);
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      columnWidths: sections.map((s) => Math.round(s.getBoundingClientRect().width)),
      spills: spills.slice(0, 5)
    };
  });
}
