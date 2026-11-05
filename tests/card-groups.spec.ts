import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Groups of cards across columns (frontend/src/lib/clusters.ts). A card keeps
 * its column, its votes and its comments when grouped. Everyone can edit groups
 * in the Group phase, and groups are hidden in Brainstorm.
 *
 * Skipped unless RETRO_LEAD_TOKEN is set (uses the lead route and archives).
 */
const LEAD_TOKEN = process.env.RETRO_LEAD_TOKEN ?? '';
const WELL = 'What went well';
const IMPROVE = 'What to improve';

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function joinAs(page: Page, path: string, name: string) {
  await page.goto(path);
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByRole('button', { name: 'Join the retro' }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page.getByTestId('board-columns')).toBeVisible();
}

const column = (page: Page, title: string) => page.getByRole('list', { name: title, exact: true });
const card = (page: Page, title: string, text: string) => column(page, title).getByRole('group', { name: `Card: ${text}` });
const groupIn = (page: Page, title: string, name: string) => column(page, title).getByRole('list', { name: new RegExp(`^Group: ${name}`) });
const groupCard = (page: Page, title: string, name: string, text: string) =>
  groupIn(page, title, name).getByRole('group', { name: `Card: ${text}` });

async function addCard(page: Page, title: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${title}`, { exact: true });
  await draft.click();
  await draft.fill(text);
  await column(page, title).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(card(page, title, text)).toBeVisible();
}

async function goTo(page: Page, direction: 'Advance to' | 'Go back to', label: string) {
  await page.getByRole('button', { name: `${direction} ${label} phase` }).click();
  await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })).toBeVisible();
}

async function newGroup(page: Page, title: string, text: string, name: string) {
  await card(page, title, text).getByRole('button', { name: 'Group this card' }).click();
  await card(page, title, text).getByRole('menuitem', { name: 'New group…' }).click();
  await card(page, title, text).getByLabel('New group name').fill(name);
  await card(page, title, text).getByRole('button', { name: 'Create' }).click();
  await expect(groupCard(page, title, name, text)).toBeVisible();
}

async function joinGroup(page: Page, title: string, text: string, name: string) {
  await card(page, title, text).getByRole('button', { name: 'Group this card' }).click();
  await card(page, title, text).getByRole('menuitem', { name, exact: true }).click();
  await expect(groupCard(page, title, name, text)).toBeVisible();
}

async function vote(page: Page, title: string, text: string) {
  await card(page, title, text).getByRole('button', { name: /^Upvote/ }).click();
  await expect(card(page, title, text).getByRole('button', { name: /^Remove vote/ })).toBeVisible();
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  return { ctx, page: await ctx.newPage() };
}

async function exportFile(page: Page, item: RegExp): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: item }).click();
    })()
  ]);
  return readFileSync((await download.path()) as string, 'utf-8');
}

// Starts a real drag and leaves it held, so controls that appear during a drag
// can be targeted. Finish with page.mouse.up().
async function startDrag(page: Page, source: ReturnType<Page['getByRole']>) {
  // hover waits for the card to stop moving: cards animate when others regroup.
  await source.hover();
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
}

async function dropOn(page: Page, target: ReturnType<Page['getByRole']>, at: 'middle' | 'top' | 'bottom' = 'middle') {
  const box = (await target.boundingBox())!;
  const y = at === 'top' ? box.y + 4 : at === 'bottom' ? box.y + box.height - 4 : box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y, { steps: 5 });
  await page.mouse.up();
}

const cardOrder = async (locator: ReturnType<Page['getByRole']>) =>
  (await locator.getByRole('group', { name: /^Card: / }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).map((l) =>
    (l ?? '').replace(/^Card: /, '')
  );

test.describe('fast-retro card groups', () => {
  test.skip(!LEAD_TOKEN, 'RETRO_LEAD_TOKEN env var must be set');

  test('dragging groups across columns, and never changes a card column by accident', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const slug = `pw-groups-drag-${suffix}`;
    const a = `alpha ${suffix}`;
    const b = `bravo ${suffix}`;
    const c = `charlie ${suffix}`;
    const d = `delta ${suffix}`;
    const lead = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await joinAs(lead.page, `/lead/${LEAD_TOKEN}/${slug}`, `Lead ${suffix}`);
      await joinAs(guest.page, `/board/${slug}`, `Guest ${suffix}`);
      await addCard(lead.page, WELL, a);
      await addCard(lead.page, WELL, c);
      await addCard(lead.page, IMPROVE, b);
      await addCard(lead.page, IMPROVE, d);
      await goTo(lead.page, 'Advance to', 'Group');
      const { page } = guest;

      // Onto the middle of a card in another column: an unnamed group, and a
      // participant can do it. Nothing changes column.
      await startDrag(page, card(page, IMPROVE, b));
      await dropOn(page, card(page, WELL, a));
      await expect(groupCard(page, WELL, 'Untitled group, 2 cards', a)).toBeVisible();
      await expect(groupCard(page, IMPROVE, 'Untitled group, 2 cards', b)).toBeVisible();
      await expect(groupCard(lead.page, IMPROVE, 'Untitled group', b)).toBeVisible();
      // No text box opened, so grouping stays quick.
      await expect(page.getByLabel('Group name')).toHaveCount(0);

      // Onto a grouped card: joins that group, from either column.
      await startDrag(page, card(page, IMPROVE, d));
      await dropOn(page, card(page, WELL, a));
      await expect(groupCard(page, IMPROVE, 'Untitled group, 3 cards', d)).toBeVisible();

      // Reordering inside the group by its edges, never grouping or merging.
      await expect.poll(() => cardOrder(groupIn(page, IMPROVE, 'Untitled group'))).toEqual([b, d]);
      await startDrag(page, card(page, IMPROVE, d));
      await dropOn(page, card(page, IMPROVE, b), 'top');
      await expect.poll(() => cardOrder(groupIn(page, IMPROVE, 'Untitled group'))).toEqual([d, b]);

      // Out of the group using the zone that appears during the drag.
      await startDrag(page, card(page, IMPROVE, d));
      const zone = column(page, IMPROVE).getByTestId('ungroup-zone');
      await expect(zone).toBeVisible();
      await dropOn(page, zone);
      await expect(groupCard(page, IMPROVE, 'Untitled group', d)).toHaveCount(0);
      await expect(card(page, IMPROVE, d)).toBeVisible();

      // Onto a group's name: joins it.
      await startDrag(page, card(page, WELL, c));
      await dropOn(page, groupIn(page, IMPROVE, 'Untitled group').locator('h3'));
      await expect(groupCard(page, WELL, 'Untitled group, 3 cards', c)).toBeVisible();

      // Dragging out the second-last card leaves a normal card, not a group of one.
      for (const text of [c, a]) {
        await startDrag(page, card(page, WELL, text));
        await dropOn(page, column(page, WELL).getByTestId('ungroup-zone'));
      }
      await expect(page.getByTestId('group-block')).toHaveCount(0);
      await expect(card(page, IMPROVE, b)).toBeVisible();

      // Into another column's loose area: moves it there. That's the way to
      // change column, and it leaves the group.
      await startDrag(page, card(page, WELL, a));
      await dropOn(page, card(page, IMPROVE, d), 'bottom');
      await expect(card(page, IMPROVE, a)).toBeVisible();
      await expect(card(page, WELL, a)).toHaveCount(0);
      await expect.poll(() => cardOrder(column(page, IMPROVE))).toEqual([d, a, b]);

      // A participant has no Merge, and neither does a phase other than Group.
      await startDrag(page, card(page, IMPROVE, b));
      await dropOn(page, card(page, IMPROVE, d));
      await expect(groupIn(page, IMPROVE, 'Untitled group, 2 cards')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Merge/ })).toHaveCount(0);
      await expect(lead.page.getByRole('button', { name: /^Merge/ })).toHaveCount(1);
      await goTo(lead.page, 'Advance to', 'Vote');
      await expect(lead.page.getByRole('button', { name: /^Merge/ })).toHaveCount(0);

      // Outside the Group phase a drop is a plain move and groups don't change.
      await startDrag(lead.page, card(lead.page, IMPROVE, a));
      await dropOn(lead.page, card(lead.page, IMPROVE, b));
      await expect(card(lead.page, IMPROVE, a)).toBeVisible();
      await expect(groupCard(lead.page, IMPROVE, 'Untitled group, 2 cards', a)).toHaveCount(0);
    } finally {
      await lead.ctx.close();
      await guest.ctx.close();
    }
  });

  test('anyone can group cards across columns, and everyone sees it live', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const slug = `pw-groups-${suffix}`;
    const one = `calm deploys ${suffix}`;
    const two = `slow rollback ${suffix}`;
    const three = `lunch ${suffix}`;
    const lead = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await joinAs(lead.page, `/lead/${LEAD_TOKEN}/${slug}`, `Lead ${suffix}`);
      await joinAs(guest.page, `/board/${slug}`, `Guest ${suffix}`);
      await addCard(lead.page, WELL, one);
      await addCard(lead.page, WELL, three);
      await addCard(lead.page, IMPROVE, two);

      // No grouping controls until the Group phase.
      await expect(card(lead.page, WELL, one).getByRole('button', { name: 'Group this card' })).toHaveCount(0);
      await goTo(lead.page, 'Advance to', 'Group');
      await expect(card(guest.page, WELL, one).getByRole('button', { name: 'Group this card' })).toBeVisible();

      // A participant creates it, the lead joins from another column.
      await newGroup(guest.page, WELL, one, 'Deploys');
      await expect(groupCard(lead.page, WELL, 'Deploys', one)).toBeVisible();
      await joinGroup(lead.page, IMPROVE, two, 'Deploys');

      for (const page of [lead.page, guest.page]) {
        await expect(groupIn(page, WELL, 'Deploys, 2 cards')).toBeVisible();
        await expect(groupIn(page, IMPROVE, 'Deploys, 2 cards')).toBeVisible();
        // Each card stays in its own column, and ungrouped cards stay outside.
        await expect(card(page, WELL, two)).toHaveCount(0);
        await expect(card(page, IMPROVE, one)).toHaveCount(0);
        await expect(card(page, WELL, three)).toBeVisible();
        await expect(groupCard(page, WELL, 'Deploys', three)).toHaveCount(0);
        // The column's count includes grouped cards.
        await expect(column(page, WELL).locator('header').getByText('2', { exact: true })).toBeVisible();
        await expect(column(page, IMPROVE).locator('header').getByText('1', { exact: true })).toBeVisible();
      }

      // Action items can't be grouped.
      await goTo(lead.page, 'Advance to', 'Vote');
      await goTo(lead.page, 'Advance to', 'Discuss');
      await goTo(lead.page, 'Advance to', 'Actions');
      await addCard(lead.page, 'Action items', `follow up ${suffix}`);
      await goTo(lead.page, 'Go back to', 'Discuss');
      await goTo(lead.page, 'Go back to', 'Vote');
      await goTo(lead.page, 'Go back to', 'Group');
      await expect(card(lead.page, 'Action items', `follow up ${suffix}`)).toBeVisible();
      await expect(card(lead.page, 'Action items', `follow up ${suffix}`).getByRole('button', { name: 'Group this card' })).toHaveCount(0);
    } finally {
      await lead.ctx.close();
      await guest.ctx.close();
    }
  });

  test('rename, leave and Ungroup all work, survive a reload and never move a card', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const one = `first ${suffix}`;
    const two = `second ${suffix}`;
    const three = `third ${suffix}`;
    const lead = await newPage(browser);
    try {
      const { page } = lead;
      await joinAs(page, `/lead/${LEAD_TOKEN}/pw-groups-edit-${suffix}`, `Lead ${suffix}`);
      await addCard(page, WELL, one);
      await addCard(page, WELL, three);
      await addCard(page, IMPROVE, two);
      await goTo(page, 'Advance to', 'Group');
      await newGroup(page, WELL, one, 'Old name');
      await joinGroup(page, IMPROVE, two, 'Old name');
      await joinGroup(page, WELL, three, 'Old name');
      await expect(groupIn(page, WELL, 'Old name, 3 cards')).toBeVisible();

      // Rename from any block.
      await groupIn(page, IMPROVE, 'Old name').getByRole('button', { name: 'Old name', exact: true }).click();
      await page.getByLabel('Group name').fill('New name');
      await page.keyboard.press('Enter');
      await expect(groupIn(page, WELL, 'New name')).toBeVisible();

      await page.reload();
      await dismissOnboardingIfPresent(page);
      await expect(groupCard(page, IMPROVE, 'New name', two)).toBeVisible();

      // Leave: back to the loose area, same column.
      await card(page, WELL, three).getByRole('button', { name: 'Group this card' }).click();
      await card(page, WELL, three).getByRole('menuitem', { name: 'Remove from group' }).click();
      await expect(groupCard(page, WELL, 'New name', three)).toHaveCount(0);
      await expect(card(page, WELL, three)).toBeVisible();
      await expect(groupIn(page, WELL, 'New name, 2 cards')).toBeVisible();

      // Clearing the name of a two-card group shows it as untitled.
      await groupIn(page, WELL, 'New name').getByRole('button', { name: 'New name', exact: true }).click();
      await page.getByLabel('Group name').fill('');
      await page.keyboard.press('Enter');
      await expect(groupIn(page, WELL, 'Untitled group, 2 cards')).toBeVisible();

      // Ungroup: no blocks left, every card where it was.
      await groupIn(page, WELL, 'Untitled group').getByRole('button', { name: 'Ungroup Untitled group' }).click();
      await expect(page.getByTestId('group-block')).toHaveCount(0);
      await expect(card(page, WELL, one)).toBeVisible();
      await expect(card(page, WELL, three)).toBeVisible();
      await expect(card(page, IMPROVE, two)).toBeVisible();
    } finally {
      await lead.ctx.close();
    }
  });

  test('Shift+Up and Shift+Down reorder within a section and stop at its edge', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const lead = await newPage(browser);
    const texts = ['a', 'b', 'c', 'd'].map((t) => `${t} ${suffix}`);
    const order = async (locator: ReturnType<Page['getByRole']>) =>
      (await locator.getByRole('group', { name: /^Card: / }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).map((l) =>
        (l ?? '').replace(/^Card: /, '')
      );
    try {
      const { page } = lead;
      await joinAs(page, `/lead/${LEAD_TOKEN}/pw-groups-keys-${suffix}`, `Lead ${suffix}`);
      for (const t of texts) await addCard(page, WELL, t);
      const [a, b, c, d] = texts;

      // Shift+Down moves a card down (this was once a no-op).
      await card(page, WELL, a).focus();
      await page.keyboard.press('Shift+ArrowDown');
      await expect.poll(() => order(column(page, WELL))).toEqual([b, a, c, d]);

      await goTo(page, 'Advance to', 'Group');
      await newGroup(page, WELL, c, 'Pair');
      await joinGroup(page, WELL, d, 'Pair');
      const group = groupIn(page, WELL, 'Pair');

      await card(page, WELL, d).focus();
      await page.keyboard.press('Shift+ArrowUp');
      await expect.poll(() => order(group)).toEqual([d, c]);
      // At the top of the group: stays in it.
      await card(page, WELL, d).focus();
      await page.keyboard.press('Shift+ArrowUp');
      await page.waitForTimeout(200);
      expect(await order(group)).toEqual([d, c]);

      // At the bottom of the loose area: doesn't wander anywhere.
      await card(page, WELL, a).focus();
      await page.keyboard.press('Shift+ArrowDown');
      await page.waitForTimeout(200);
      expect(await order(group)).toEqual([d, c]);
      await expect(group.getByRole('group', { name: `Card: ${a}` })).toHaveCount(0);

      // Moving sideways keeps the group, in the new column.
      await card(page, WELL, c).focus();
      await page.keyboard.press('Shift+ArrowRight');
      await expect(groupCard(page, IMPROVE, 'Pair', c)).toBeVisible();
      await expect(groupCard(page, WELL, 'Pair', d)).toBeVisible();
    } finally {
      await lead.ctx.close();
    }
  });

  test('going back to Brainstorm hides group names, and they return in Group', async ({ browser }) => {
    test.setTimeout(90_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const lead = await newPage(browser);
    const guest = await newPage(browser);
    const slug = `pw-groups-hide-${suffix}`;
    const mine = `lead card ${suffix}`;
    const secret = `Secret topic ${suffix}`;
    try {
      await joinAs(lead.page, `/lead/${LEAD_TOKEN}/${slug}`, `Lead ${suffix}`);
      await joinAs(guest.page, `/board/${slug}`, `Guest ${suffix}`);
      await addCard(lead.page, WELL, mine);
      await goTo(lead.page, 'Advance to', 'Group');
      await newGroup(lead.page, WELL, mine, secret);
      await expect(groupIn(guest.page, WELL, secret)).toBeVisible();

      await lead.page.getByRole('button', { name: "Hide others' cards" }).click();
      await goTo(lead.page, 'Go back to', 'Brainstorm');
      await expect(guest.page.getByTestId('hidden-card')).toHaveCount(1);
      await expect(guest.page.getByTestId('group-block')).toHaveCount(0);
      expect(await guest.page.content()).not.toContain(secret);

      await goTo(lead.page, 'Advance to', 'Group');
      await expect(groupCard(guest.page, WELL, secret, mine)).toBeVisible();
    } finally {
      await lead.ctx.close();
      await guest.ctx.close();
    }
  });

  test('a group counts people, not votes, and Discuss sorts groups by that count', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const lead = await newPage(browser);
    const guest = await newPage(browser);
    const slug = `pw-groups-vote-${suffix}`;
    const popular1 = `popular one ${suffix}`;
    const popular2 = `popular two ${suffix}`;
    const quiet = `quiet ${suffix}`;
    const quiet2 = `quiet too ${suffix}`;
    try {
      await joinAs(lead.page, `/lead/${LEAD_TOKEN}/${slug}`, `Lead ${suffix}`);
      await joinAs(guest.page, `/board/${slug}`, `Guest ${suffix}`);
      for (const t of [quiet, quiet2, popular1, popular2]) await addCard(lead.page, WELL, t);
      await goTo(lead.page, 'Advance to', 'Group');
      await newGroup(lead.page, WELL, quiet, 'Quiet');
      await joinGroup(lead.page, WELL, quiet2, 'Quiet');
      await newGroup(lead.page, WELL, popular1, 'Popular');
      await joinGroup(lead.page, WELL, popular2, 'Popular');

      await goTo(lead.page, 'Advance to', 'Vote');
      // Quiet: one person on two cards. Popular: two people.
      await vote(lead.page, WELL, quiet);
      await vote(lead.page, WELL, quiet2);
      await vote(lead.page, WELL, popular1);
      await vote(guest.page, WELL, popular2);
      await expect(groupIn(lead.page, WELL, 'Quiet')).toContainText('1 voter');
      await expect(groupIn(lead.page, WELL, 'Popular')).toContainText('2 voters');

      const names = () => column(lead.page, WELL).getByTestId('group-block').locator('h3').allInnerTexts();
      await expect.poll(names).toEqual(['Quiet', 'Popular']);
      await goTo(lead.page, 'Advance to', 'Discuss');
      await expect.poll(names).toEqual(['Popular', 'Quiet']);
    } finally {
      await lead.ctx.close();
      await guest.ctx.close();
    }
  });

  test('groups survive export, re-import and ending the retro', async ({ browser }) => {
    test.setTimeout(150_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const lead = await newPage(browser);
    const importer = await newPage(browser);
    const slug = `pw-groups-file-${suffix}`;
    const one = `grouped one ${suffix}`;
    const two = `grouped two ${suffix}`;
    const plain = `plain ${suffix}`;
    try {
      const { page } = lead;
      await joinAs(page, `/lead/${LEAD_TOKEN}/${slug}`, `Lead ${suffix}`);
      await addCard(page, WELL, one);
      await addCard(page, WELL, plain);
      await addCard(page, IMPROVE, two);
      await goTo(page, 'Advance to', 'Group');
      await newGroup(page, WELL, one, 'Deploys');
      await joinGroup(page, IMPROVE, two, 'Deploys');

      // The board file and the spreadsheet.
      const fileText = await exportFile(page, /^Save board file/);
      const file = JSON.parse(fileText);
      expect(file.version).toBe(3);
      expect(file.board.clusters).toHaveLength(1);
      expect(file.board.clusters[0].label).toBe('Deploys');
      const csv = await exportFile(page, /^Spreadsheet/);
      expect(csv).toContain('column,card_text,votes,reactions,comments,group');
      expect(csv).toContain(`${one},0,,,Deploys`);
      expect(csv).toContain(`${plain},0,,,`);

      // Re-import in a fresh browser.
      await importer.page.addInitScript(() => {
        localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
      });
      await importer.page.goto('/');
      await importer.page.getByRole('button', { name: 'Start a new retro' }).click();
      const dialog = importer.page.getByRole('dialog', { name: 'Start a new retro' });
      const [chooser] = await Promise.all([
        importer.page.waitForEvent('filechooser'),
        dialog.getByRole('button', { name: 'Import from file…' }).click()
      ]);
      await chooser.setFiles({ name: 'groups.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(fileText) });
      await expect(dialog.getByRole('status', { name: 'Import preview' })).toContainText('1 group');
      await dialog.getByRole('button', { name: 'Import retro' }).click();
      await importer.page.waitForURL(/\/board\//);
      const nameInput = importer.page.getByLabel('Your display name');
      await expect(nameInput).toBeVisible();
      await nameInput.fill(`Importer ${suffix}`);
      await importer.page.getByRole('button', { name: 'Join the retro' }).click();
      await dismissOnboardingIfPresent(importer.page);
      await expect(groupCard(importer.page, WELL, 'Deploys, 2 cards', one)).toBeVisible();
      await expect(groupCard(importer.page, IMPROVE, 'Deploys, 2 cards', two)).toBeVisible();
      await expect(card(importer.page, WELL, plain)).toBeVisible();

      // End the retro: the ended board and the archive viewer both show it.
      await page.getByRole('button', { name: 'End retro' }).click();
      const end = page.getByRole('alertdialog');
      await end.getByRole('button', { name: 'Archive & end' }).click();
      await expect(end).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText('This retro has ended')).toBeVisible();
      await expect(groupCard(page, WELL, 'Deploys', one)).toBeVisible();
      await expect(card(page, WELL, one).getByRole('button', { name: 'Group this card' })).toHaveCount(0);
      await expect(groupIn(page, WELL, 'Deploys').getByRole('button', { name: /^Ungroup/ })).toHaveCount(0);

      await page.goto(`/lead/${LEAD_TOKEN}/archives`);
      const item = page.getByTestId('archive-item').filter({ hasText: slug }).first();
      await expect(item).toBeVisible({ timeout: 10_000 });
      await item.getByRole('link').first().click();
      await expect(page.getByTestId('archive-group')).toHaveCount(2);
      await expect(page.getByTestId('archive-group').first()).toContainText('Deploys');
      await expect(page.getByTestId('archive-group').first()).toContainText(one);
      await expect(page.getByTestId('archive-group').first()).not.toContainText(plain);
      await expect(page.getByTestId('archive-card').filter({ hasText: plain })).toBeVisible();

      // The archive's own download keeps them too.
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save board file' }).click()]);
      const fromArchive = JSON.parse(readFileSync((await download.path()) as string, 'utf-8'));
      expect(fromArchive.version).toBe(3);
      expect(fromArchive.board.clusters[0].label).toBe('Deploys');
    } finally {
      await lead.ctx.close();
      await importer.ctx.close();
    }
  });
});
