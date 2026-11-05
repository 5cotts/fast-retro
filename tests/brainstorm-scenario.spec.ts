import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * The problem-solving brainstorm that prompted custom columns
 * (docs/custom-columns-plan.md): "here are 5 problem statements, generate
 * ideas for potential solutions in private for 10 minutes, then we reveal,
 * group and do some discussion."
 *
 * A host creates a custom board with one column per problem statement, no
 * Action items column and hidden cards on. Once people have joined, the host
 * realizes a problem statement is missing and adds it from Edit board. Then
 * the host starts a 10-minute timer.
 * Two participants write ideas without seeing each other's. Group reveals
 * everything; the host merges a duplicate; the team votes; Discuss sorts by
 * votes, is the last phase, and takes comments. The board ends and exports.
 *
 * docs/qa-brainstorm-scenario.md is the same scenario as a manual script.
 * Boards are created from the homepage, so no RETRO_LEAD_TOKEN is needed.
 */

const PROBLEMS = [
  'How might we cut onboarding time?',
  'How might we make deploys boring?',
  'How might we make on-call less painful?',
  'How might we keep docs up to date?',
  'How might we have fewer meetings?'
];

async function dismissOnboardingIfPresent(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }
}

async function joinIfAsked(page: Page, name: string) {
  const nameInput = page.getByLabel('Your display name');
  await expect(nameInput.or(page.getByTestId('board-columns'))).toBeVisible();
  if (await nameInput.isVisible()) {
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Join the retro' }).click();
  }
  await dismissOnboardingIfPresent(page);
  await expect(page.getByTestId('board-columns')).toBeVisible();
}

function column(page: Page, title: string) {
  return page.getByRole('list', { name: title, exact: true });
}

function card(page: Page, title: string, text: string) {
  return column(page, title).getByRole('group', { name: `Card: ${text}` });
}

function hidden(page: Page, title: string) {
  return column(page, title).getByTestId('hidden-card');
}

async function addCard(page: Page, title: string, text: string) {
  const draft = page.getByLabel(`Add a card to ${title}`, { exact: true });
  await draft.click();
  await draft.fill(text);
  await column(page, title).getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(card(page, title, text)).toBeVisible();
}

async function columnTitles(page: Page): Promise<string[]> {
  return page
    .getByTestId('board-columns')
    .locator(':scope > section')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: `Advance to ${label} phase` }).click();
  await expect(page.locator('[role="listitem"][aria-current="step"]').filter({ hasText: label })).toBeVisible();
}

async function expectPhase(page: Page, label: string) {
  await expect(page.locator('[role="listitem"][aria-current="step"]')).toHaveText(new RegExp(label), { timeout: 10_000 });
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe('fast-retro problem-solving brainstorm', () => {
  test('5 problem statements, 10 minutes of private ideas, then reveal, group and discuss', async ({ browser }) => {
    test.setTimeout(180_000);
    const suffix = Math.random().toString(36).slice(2, 6);
    const host = await newPage(browser);
    const ana = await newPage(browser);
    const ben = await newPage(browser);
    const contexts = [host.ctx, ana.ctx, ben.ctx];
    try {
      // 1. The host sets up the board: one column per problem statement (but
      //    forgets the last one), no Action items, others' cards hidden while
      //    brainstorming.
      await host.page.addInitScript(() => {
        localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }]));
      });
      await host.page.goto('/');
      await host.page.getByRole('button', { name: 'Start a new retro' }).click();
      const dialog = host.page.getByRole('dialog', { name: 'Start a new retro' });
      await dialog.getByLabel('Retro name').fill(`Brainstorm ${suffix}`);
      await dialog.getByRole('radiogroup', { name: 'Board type' }).getByText('Custom', { exact: true }).click();
      await dialog.getByLabel('Column 1 name').fill(PROBLEMS[0]);
      for (let i = 1; i < PROBLEMS.length - 1; i++) {
        await dialog.getByRole('button', { name: 'Add column' }).click();
        await expect(dialog.getByLabel(`Column ${i + 1} name`)).toBeFocused();
        await host.page.keyboard.type(PROBLEMS[i]);
      }
      await dialog.getByRole('checkbox', { name: /^Action items column/ }).uncheck();
      await dialog.getByRole('checkbox', { name: /^Hide others' cards while brainstorming/ }).check();
      await dialog.getByRole('button', { name: 'Create retro' }).click();
      await host.page.waitForURL(/\/board\/brainstorm-/);
      await joinIfAsked(host.page, 'Valentina');
      expect(await columnTitles(host.page)).toEqual(PROBLEMS.slice(0, -1));
      await expect(host.page.getByRole('list', { name: 'Phases' }).getByRole('listitem')).toHaveText([
        /Brainstorm/,
        /Group/,
        /Vote/,
        /Discuss/
      ]);

      // 2. Participants join from the link and see the same four columns.
      for (const [p, name] of [
        [ana.page, 'Ana'],
        [ben.page, 'Ben']
      ] as const) {
        await p.goto(host.page.url());
        await joinIfAsked(p, name);
        expect(await columnTitles(p)).toEqual(PROBLEMS.slice(0, -1));
        await expect(p.getByTestId('hidden-cards-banner')).toBeVisible();
      }

      // 2b. The host notices the fifth problem statement is missing and adds
      //     it from Edit board, without making a new board.
      await host.page.getByRole('button', { name: 'Edit board' }).click();
      const edit = host.page.getByRole('dialog', { name: 'Edit board' });
      await edit.getByRole('button', { name: 'Add column' }).click();
      await expect(edit.getByLabel(`Column ${PROBLEMS.length} name`)).toBeFocused();
      await host.page.keyboard.type(PROBLEMS[PROBLEMS.length - 1]);
      await edit.getByRole('button', { name: 'Save', exact: true }).click();
      for (const p of [host.page, ana.page, ben.page]) {
        await expect.poll(() => columnTitles(p), { timeout: 10_000 }).toEqual(PROBLEMS);
      }

      // 3. The host starts a 10-minute timer, which everyone sees.
      await host.page.locator('[title="Timer controls"]').first().click();
      const timer = host.page.getByRole('dialog', { name: 'Timer controls' });
      await timer.getByLabel('Timer minutes').fill('10');
      await timer.getByRole('button', { name: 'Set', exact: true }).click();
      await timer.getByRole('button', { name: 'Start timer' }).click();
      await host.page.keyboard.press('Escape');
      for (const p of [ana.page, ben.page]) {
        await expect(p.getByRole('timer')).toHaveText(/(10:00|9:[0-5]\d)/, { timeout: 5_000 });
      }

      // 4. Private ideas: everyone writes in several columns, and nobody can
      //    read anyone else's ideas.
      const ideas = {
        ana: [
          [0, `Ana: pair new hires with a buddy ${suffix}`],
          [1, `Ana: deploy on every merge ${suffix}`],
          [4, `Ana: no-meeting Wednesdays ${suffix}`]
        ],
        ben: [
          [0, `Ben: onboarding buddy system ${suffix}`],
          [2, `Ben: follow-the-sun rotation ${suffix}`],
          [4, `Ben: async standups ${suffix}`]
        ],
        host: [[3, `Valentina: docs owner per team ${suffix}`]]
      } as const;
      for (const [i, text] of ideas.ana) await addCard(ana.page, PROBLEMS[i], text);
      for (const [i, text] of ideas.ben) await addCard(ben.page, PROBLEMS[i], text);
      for (const [i, text] of ideas.host) await addCard(host.page, PROBLEMS[i], text);

      // Ana sees Ben's two cards in column 1 and column 5 as placeholders only.
      await expect(hidden(ana.page, PROBLEMS[0])).toHaveCount(1, { timeout: 10_000 });
      await expect(hidden(ana.page, PROBLEMS[4])).toHaveCount(1);
      await expect(hidden(ana.page, PROBLEMS[3])).toHaveCount(1);
      // The host's own view hides participants' ideas too.
      await expect(hidden(host.page, PROBLEMS[0])).toHaveCount(2, { timeout: 10_000 });
      for (const [, text] of [...ideas.ben, ...ideas.host]) {
        await expect(ana.page.locator('body')).not.toContainText(text);
      }
      for (const [, text] of [...ideas.ana, ...ideas.ben]) {
        await expect(host.page.locator('body')).not.toContainText(text);
      }

      // 5. Reveal: moving to Group shows every idea to everyone at once.
      await advance(host.page, 'Group');
      for (const p of [host.page, ana.page, ben.page]) {
        await expectPhase(p, 'Group');
        await expect(p.getByTestId('hidden-card')).toHaveCount(0);
        for (const [i, text] of [...ideas.ana, ...ideas.ben, ...ideas.host]) {
          await expect(card(p, PROBLEMS[i], text)).toBeVisible({ timeout: 10_000 });
        }
      }

      // 6. Group: dragging one buddy-system idea onto the other groups them. The
      // host then merges the group into one card.
      const anaBuddy = ideas.ana[0][1];
      const benBuddy = ideas.ben[0][1];
      await card(host.page, PROBLEMS[0], benBuddy).dragTo(card(host.page, PROBLEMS[0], anaBuddy));
      const buddies = column(ana.page, PROBLEMS[0]).getByRole('list', { name: /^Group: Untitled group, 2 cards/ });
      await expect(buddies.getByRole('group', { name: `Card: ${anaBuddy}` })).toBeVisible({ timeout: 10_000 });
      await expect(buddies.getByRole('group', { name: `Card: ${benBuddy}` })).toBeVisible();
      await host.page.getByRole('button', { name: 'Merge Untitled group' }).click();
      await host.page.getByRole('button', { name: 'Merge cards' }).click();
      const merged = column(ana.page, PROBLEMS[0]).getByRole('group', { name: /^Card: / });
      await expect(merged).toHaveCount(1, { timeout: 10_000 });
      await expect(merged).toContainText(anaBuddy);
      await expect(merged).toContainText(benBuddy);

      // 7. Vote: participants upvote the ideas they want to discuss.
      await advance(host.page, 'Vote');
      const asyncStandups = ideas.ben[2][1];
      const noMeetings = ideas.ana[2][1];
      for (const p of [ana.page, ben.page]) {
        await expectPhase(p, 'Vote');
        await card(p, PROBLEMS[4], asyncStandups).getByRole('button', { name: /^Upvote/ }).click();
      }
      await card(ana.page, PROBLEMS[4], noMeetings).getByRole('button', { name: /^Upvote/ }).click();
      await card(ben.page, PROBLEMS[0], anaBuddy).getByRole('button', { name: /^Upvote/ }).click();

      // 8. Discuss is the last phase: the top idea sorts first and takes comments.
      await advance(host.page, 'Discuss');
      await expect(host.page.getByRole('button', { name: /^Advance to/ })).toHaveCount(0);
      const fewerMeetings = column(ben.page, PROBLEMS[4]).getByRole('group', { name: /^Card: / });
      await expect(fewerMeetings.first()).toContainText(asyncStandups, { timeout: 10_000 });
      const top = card(ben.page, PROBLEMS[4], asyncStandups);
      const commentsToggle = top.getByRole('button', { name: /Comments/ });
      if (!(await top.getByPlaceholder('Add a comment…').isVisible())) await commentsToggle.click();
      await top.getByPlaceholder('Add a comment…').fill('Try it for two sprints');
      await top.getByRole('button', { name: 'Post', exact: true }).click();
      // Others see the count update live; their panel opens on click.
      const anaTop = card(ana.page, PROBLEMS[4], asyncStandups);
      await anaTop.getByRole('button', { name: 'Comments (1)' }).click({ timeout: 10_000 });
      await expect(anaTop).toContainText('Try it for two sprints');

      // 9. The host ends the session; anyone can still export the result.
      await host.page.getByRole('button', { name: 'End retro' }).click();
      await host.page.getByRole('alertdialog').getByRole('button', { name: 'Archive & end' }).click();
      for (const p of [host.page, ana.page]) {
        await expect(p.getByText('This retro has ended')).toBeVisible({ timeout: 15_000 });
      }
      await expect(host.page.getByText(/^Bring \d+ action item/)).toHaveCount(0);
      const [download] = await Promise.all([
        ana.page.waitForEvent('download'),
        (async () => {
          await ana.page.getByRole('button', { name: 'Export', exact: true }).first().click();
          await ana.page.getByRole('menuitem', { name: /^Save board file/ }).click();
        })()
      ]);
      const file = JSON.parse(readFileSync((await download.path()) as string, 'utf-8'));
      expect(file.board.columns.map((c: { title: string }) => c.title)).toEqual(PROBLEMS);
      expect(file.board.hideCards).toBe(true);
      expect(file.board.phase).toBe('discuss');
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });
});
