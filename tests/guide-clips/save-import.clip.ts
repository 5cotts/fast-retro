import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { clickOn, clip, middleOf, showImportNote } from './helpers';

clip(
  'save-import',
  {
    layout: 'columns',
    phase: 'discuss',
    showsHeader: true,
    cards: { wentWell: [{ text: 'Deploy rollback saved us' }], toImprove: [{ text: 'Deploys were slow on Friday' }] }
  },
  async ({ page, action, crop }) => {
    crop({ x: 0, y: 0, width: 800, height: 560 });
    const exportButton = page.getByRole('button', { name: 'Export', exact: true }).first();
    const onExport = await middleOf(exportButton);
    const rest = { x: onExport.x - 60, y: onExport.y + 220 };
    await page.mouse.move(rest.x, rest.y);
    action();
    await page.waitForTimeout(300);
    await clickOn(page, rest, exportButton, 450);
    await page.waitForTimeout(350);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      clickOn(page, onExport, page.getByRole('menuitem', { name: /Save board file/ }), 350)
    ]);
    const saved = readFileSync((await download.path()) as string);
    await page.waitForTimeout(400);

    const home = page.getByRole('link', { name: 'Fast Retro — home' });
    await clickOn(page, onExport, home, 500);
    const start = page.getByRole('button', { name: 'Start a new retro' });
    await expect(start).toBeVisible();
    await showImportNote(page);
    await page.waitForTimeout(250);
    const onStart = await clickOn(page, { x: 60, y: 30 }, start, 500);
    const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    const importButton = dialog.getByRole('button', { name: 'Import from file…' });
    const onImport = await middleOf(importButton);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickOn(page, onStart, importButton, 400)]);
    await chooser.setFiles({ name: 'sprint-42.fastretro.json', mimeType: 'application/json', buffer: saved });
    await expect(dialog.getByRole('status', { name: 'Import preview' })).toBeVisible();
    await page.waitForTimeout(800);

    await clickOn(page, onImport, dialog.getByRole('button', { name: 'Import retro' }), 400);
    await page.waitForURL(/\/board\//);
    await expect(page.getByRole('group', { name: 'Card: Deploy rollback saved us' })).toBeVisible();
    await expect(page.getByTestId('imported-note')).toBeVisible();
  }
);
