import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * The session that prompted canvas mode (docs/canvas-mode-plan.md):
 *
 *   "I like columns most of the time, but canvas mode can group in a more nuanced
 *   way, where the proximity matters, not the binary of grouped/not grouped"
 *
 * A host starts a canvas with three prompts and hidden cards. Ana and Ben write in
 * private, then Group reveals everything. A "went OK" card and a "went well" card
 * about the same thing go side by side and keep their colors, a third card sits
 * between two themes, and floating labels name the themes. The team votes, Discuss
 * uses Top voted, Actions fills the dock, and the board ends. Its file rebuilds
 * the same layout, and the next retro is a canvas again.
 *
 * docs/qa-canvas.md is the same session as a manual script. Boards are created
 * from the homepage, so no RETRO_LEAD_TOKEN is needed.
 */
const VIEWPORT = { width: 1400, height: 900 };

async function open(browser: Browser, url: string, name: string) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByLabel('Your display name').fill(name);
  await page.getByRole('button', { name: 'Join the retro' }).click();
  await settle(page);
  return { ctx, page };
}

async function settle(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await expect(gotIt).toBeHidden();
}

const card = (page: Page, text: string) => page.getByTestId('canvas-card').filter({ hasText: text });
const label = (page: Page, text: string) => page.getByTestId('canvas-label').filter({ hasText: text });
const worldPos = (el: Locator) =>
  el.evaluate((node) => {
    const m = (node as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  });

async function compose(page: Page, prompt: string, text: string) {
  const composer = page.getByTestId('canvas-composer');
  await composer.getByRole('radiogroup', { name: 'Prompt' }).getByText(prompt, { exact: true }).click();
  await composer.getByRole('textbox').fill(text);
  await composer.getByRole('textbox').press('Enter');
  await expect(card(page, text)).toBeVisible();
}

// Drops one card just to the right of another, on screen.
async function dropBeside(page: Page, moving: Locator, target: Locator) {
  await page.getByRole('button', { name: 'Fit' }).click();
  const from = await moving.boundingBox();
  const to = await target.boundingBox();
  const grab = { x: from!.x + from!.width / 2, y: from!.y + 16 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  const end = { x: to!.x + to!.width + 12 + from!.width / 2, y: to!.y + 16 };
  await page.mouse.move((grab.x + end.x) / 2, (grab.y + end.y) / 2, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

async function saveBoardFile(page: Page) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).first().click();
      await page.getByRole('menuitem', { name: /Save board file/ }).click();
    })()
  ]);
  return readFileSync((await file.path()) as string, 'utf-8');
}

const next = (page: Page, phase: string) => page.getByRole('button', { name: `Advance to ${phase} phase` }).click();

test('a canvas retro, start to finish', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = Math.random().toString(36).slice(2, 6);
  const friday = `Friday deploy had no drama ${s}`;
  const slow = `Deploys were fine but slow ${s}`;
  const newHire = `New hire shipped a deploy on day 3 ${s}`;
  const docs = `Onboarding docs are stale ${s}`;
  const contexts = [];
  try {
    // 1. The host starts a canvas with hidden cards.
    const hostCtx = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(hostCtx);
    const host = await hostCtx.newPage();
    await host.addInitScript(() => {
      localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
    });
    await host.goto('/');
    await host.getByRole('button', { name: 'Start a new retro' }).click();
    const dialog = host.getByRole('dialog', { name: 'Start a new retro' });
    await dialog.getByLabel('Retro name').fill(`Sprint ${s}`);
    await dialog.getByRole('radiogroup', { name: 'Board type' }).getByText('Canvas', { exact: true }).click();
    await dialog.getByLabel('Prompt 1 name').fill('Went well');
    await dialog.getByRole('button', { name: 'Add prompt' }).click();
    await dialog.getByLabel('Prompt 2 name').fill('Went OK');
    await dialog.getByRole('button', { name: 'Add prompt' }).click();
    await dialog.getByLabel('Prompt 3 name').fill('To improve');
    await dialog.getByLabel(/Hide others' cards/).check();
    await dialog.getByRole('button', { name: 'Create retro' }).click();
    await host.waitForURL(/\/board\//);
    await host.getByLabel('Your display name').fill('Host');
    await host.getByRole('button', { name: 'Join the retro' }).click();
    await settle(host);
    const url = host.url();

    const ana = await open(browser, url, 'Ana');
    contexts.push(ana.ctx);
    const ben = await open(browser, url, 'Ben');
    contexts.push(ben.ctx);

    // 2. Brainstorm in private.
    await compose(ana.page, 'Went well', friday);
    await compose(ana.page, 'Went well', newHire);
    await compose(ben.page, 'Went OK', slow);
    await compose(ben.page, 'To improve', docs);
    await expect(ana.page.getByTestId('canvas-card')).toHaveCount(4);
    await expect(ana.page.getByText(slow)).toHaveCount(0);
    await expect(ben.page.getByText(friday)).toHaveCount(0);
    await expect(host.getByText(friday)).toHaveCount(0);

    // 3. Group reveals it all, and the same thing from two prompts goes together.
    await next(host, 'Group');
    for (const page of [host, ana.page, ben.page]) await expect(card(page, friday)).toBeVisible();
    await dropBeside(ben.page, card(ben.page, slow), card(ben.page, friday));
    await expect.poll(() => worldPos(card(ana.page, slow))).toEqual(await worldPos(card(ben.page, slow)));
    const fridayAt = (await worldPos(card(ana.page, friday)))!;
    const slowAt = (await worldPos(card(ana.page, slow)))!;
    expect(Math.abs(slowAt.y - fridayAt.y)).toBeLessThan(60);
    expect(Math.abs(slowAt.x - fridayAt.x)).toBeLessThan(400);
    // Next to each other, and still visibly from different prompts.
    expect(await card(ana.page, friday).getAttribute('data-color')).not.toBe(await card(ana.page, slow).getAttribute('data-color'));

    // A card can sit between two themes: there's no membership to choose.
    await dropBeside(ana.page, card(ana.page, newHire), card(ana.page, slow));
    await dropBeside(ana.page, card(ana.page, docs), card(ana.page, newHire));

    // Floating labels name the themes.
    const canvas = await ana.page.getByTestId('board-canvas').boundingBox();
    await ana.page.mouse.dblclick(canvas!.x + 120, canvas!.y + canvas!.height - 80);
    await ana.page.getByLabel('New label').fill(`Deploys ${s}`);
    await ana.page.getByLabel('New label').press('Enter');
    await expect(label(ben.page, `Deploys ${s}`)).toBeVisible();

    // 4. Vote.
    await next(host, 'Vote');
    const vote = (page: Page, text: string) => card(page, text).getByRole('button', { name: /vote/i }).first().click();
    await vote(ana.page, slow);
    await vote(ben.page, slow);
    await vote(host, slow);
    await vote(ana.page, docs);
    await vote(ben.page, docs);
    await vote(ana.page, friday);

    // 5. Discuss: nothing moves on its own, and Top voted finds things.
    const before = await worldPos(card(host, docs));
    await next(host, 'Discuss');
    const panel = host.getByTestId('top-voted');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect(panel.getByRole('listitem').nth(0)).toContainText(slow);
    await expect(panel.getByRole('listitem').nth(1)).toContainText(docs);
    await expect(panel.getByRole('listitem').nth(2)).toContainText(friday);
    expect(await worldPos(card(host, docs))).toEqual(before);

    await host.getByRole('button', { name: 'Zoom in' }).click();
    await host.getByRole('button', { name: 'Zoom in' }).click();
    await panel.getByRole('button', { name: new RegExp(docs) }).click();
    await expect(card(host, docs)).toHaveAttribute('data-highlighted', '');
    const box = await card(host, docs).boundingBox();
    const hostCanvas = await host.getByTestId('board-canvas').boundingBox();
    const middle = hostCanvas!.x + hostCanvas!.width / 2;
    expect(Math.abs(box!.x + box!.width / 2 - middle)).toBeLessThan(4);
    // Only for the person who picked it, and it fades.
    await expect(card(ben.page, docs)).not.toHaveAttribute('data-highlighted', '');
    await expect(card(host, docs)).not.toHaveAttribute('data-highlighted', '', { timeout: 5_000 });

    // 6. Actions go in the dock, and Top voted stops taking up the canvas.
    await next(host, 'Actions');
    await expect(panel).toBeHidden();
    const dock = ana.page.getByTestId('canvas-dock');
    await dock.getByRole('textbox').fill(`Write the rollback steps down ${s}`);
    await dock.getByRole('textbox').press('Enter');
    await expect(host.getByTestId('canvas-dock').getByText(`Write the rollback steps down ${s}`)).toBeVisible();
    await host.getByRole('button', { name: 'Top voted' }).click();
    await expect(panel).toBeVisible();

    // 7. End it. It's read-only and can still be read, and exports for anyone.
    await host.getByRole('button', { name: 'End retro' }).click();
    await host.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
    for (const page of [host, ana.page, ben.page]) await expect(page.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
    const endedAt = await worldPos(card(ben.page, slow));
    const exported = await saveBoardFile(ben.page);

    // 8. Its file rebuilds the same layout on a new board.
    const restoreCtx = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(restoreCtx);
    const restored = await restoreCtx.newPage();
    await restored.addInitScript(() => {
      localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
    });
    await restored.goto('/');
    await restored.getByRole('button', { name: 'Start a new retro' }).click();
    const importDialog = restored.getByRole('dialog', { name: 'Start a new retro' });
    const [chooser] = await Promise.all([
      restored.waitForEvent('filechooser'),
      importDialog.getByRole('button', { name: 'Import from file…' }).click()
    ]);
    await chooser.setFiles({ name: 'retro.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await importDialog.getByRole('button', { name: 'Import retro' }).click();
    await restored.waitForURL(/\/board\//);
    await restored.getByLabel('Your display name').fill('Restorer');
    await restored.getByRole('button', { name: 'Join the retro' }).click();
    await settle(restored);
    await expect(card(restored, slow)).toBeVisible();
    expect(await worldPos(card(restored, slow))).toEqual(endedAt);
    await expect(label(restored, `Deploys ${s}`)).toBeVisible();

    // 9. The next retro is a canvas again, with the action item waiting.
    await host.getByRole('button', { name: 'Start next retro' }).click();
    await host.waitForURL((u) => u.toString() !== url && /\/board\//.test(u.pathname));
    await settle(host);
    await expect(host.getByTestId('canvas-heading')).toHaveText(['Went well', 'Went OK', 'To improve']);
    await expect(host.getByTestId('canvas-card')).toHaveCount(0);
    await expect(host.getByTestId('canvas-dock').getByText(`Write the rollback steps down ${s}`)).toBeVisible();
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});
