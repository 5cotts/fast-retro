import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Records the user guide's clips from the real app, so they can be regenerated
 * and a broken flow fails instead of leaving a wrong clip behind.
 *
 * GUIDE_CLIPS_RECORD=1 records and writes frontend/src/lib/guide/clips/. Without
 * it the same flows run, with their assertions, and nothing is recorded.
 *
 * What makes a usable clip:
 * - Seed from a board file, so every take is identical.
 * - Record a fresh session from saved storage state. Recording the session that
 *   created the board shows the host twice in the presence list.
 * - Inject a cursor. Headless recordings have no pointer, and a card moving by
 *   itself explains nothing.
 * - Crop to the action, and hold the last frame so the result registers before
 *   the loop restarts.
 */
const RECORD = process.env.GUIDE_CLIPS_RECORD === '1';
// scripts/guide-clips.sh runs from the repo root.
const OUT_DIR = join(process.cwd(), 'frontend/src/lib/guide/clips');
const HOLD_LAST_FRAME_MS = 1500;
const FPS = 15;
// About as wide as the guide's text column, so clips show near full size. Below
// 768px a canvas board opens in List view.
const VIEWPORT = { width: 800, height: 720 };

export interface SeedCard {
  text: string;
  x: number;
  y: number;
}

export interface SeedBoard {
  phase: 'brainstorm' | 'group' | 'vote' | 'discuss';
  columns: { key: string; title: string; color: string }[];
  cards: Record<string, SeedCard[]>;
}

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Clip {
  page: Page;
  card: (text: string) => Locator;
  // Marks where the clip starts. Everything before it is trimmed.
  action: () => void;
  // The region of the page to keep.
  crop: (region: Crop) => void;
}

function boardFile(seed: SeedBoard) {
  return {
    format: 'fast-retro',
    version: 4,
    exportedAt: 1,
    board: { label: 'Sprint 42', anonymous: true, phase: seed.phase, autoSort: true, layout: 'canvas', columns: seed.columns },
    cards: Object.fromEntries(
      Object.entries(seed.cards).map(([key, list]) => [
        key,
        list.map((c, i) => ({ id: `${key}${i}`, text: c.text, authorId: '', votes: [], reactions: {}, comments: [], pos: { x: c.x, y: c.y, z: i + 1 } }))
      ])
    )
  };
}

async function dismissTips(page: Page) {
  const gotIt = page.getByRole('button', { name: 'Got it' });
  await page.waitForTimeout(400);
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

// Creates the board once, as its host, and returns what a fresh session needs.
async function createBoard(browser: Browser, seed: SeedBoard) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('retro-recent-boards', JSON.stringify([{ slug: 'seeded', lastVisited: Date.now() }])));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a new retro' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new retro' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: 'Import from file…' }).click()]);
  await chooser.setFiles({ name: 'seed.fastretro.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(boardFile(seed))) });
  await dialog.getByRole('button', { name: 'Import retro' }).click();
  await page.waitForURL(/\/board\//);
  await page.getByLabel('Your display name').fill('Host');
  await page.getByRole('button', { name: 'Join the retro' }).click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await dismissTips(page);
  const state = await ctx.storageState();
  const url = page.url();
  await ctx.close();
  return { state, url };
}

function installCursor() {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;left:0;top:0;width:18px;height:18px;border-radius:50%;background:rgba(14,165,233,.55);border:2px solid #0369a1;z-index:99999;pointer-events:none';
    document.body.appendChild(dot);
    let at = '';
    let pressed = false;
    const draw = () => (dot.style.transform = `${at} scale(${pressed ? 0.7 : 1})`);
    addEventListener('pointermove', (e) => { at = `translate(${e.clientX - 9}px,${e.clientY - 9}px)`; draw(); }, true);
    addEventListener('pointerdown', () => { pressed = true; draw(); }, true);
    addEventListener('pointerup', () => { pressed = false; draw(); }, true);
  });
}

// Moves the pointer the way a person does: easing in and out, not teleporting.
export async function glide(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms: number) {
  const steps = Math.max(8, Math.round(ms / 30));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
    await page.waitForTimeout(ms / steps);
  }
}

// Fit can leave card text too small to read at clip size.
export async function zoomInTo(page: Page, percent: number) {
  const zoom = page.getByTestId('canvas-zoom');
  for (let i = 0; i < 12 && parseInt((await zoom.textContent()) ?? '0') < percent; i++) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
  }
  await page.waitForTimeout(250);
}

// Zooming about the center can push the top row above the canvas. Scrolling pans.
export async function panTopInto(page: Page, topCard: Locator, margin = 56) {
  const canvas = await page.getByTestId('board-canvas').boundingBox();
  const top = await topCard.boundingBox();
  if (!canvas || !top) throw new Error('canvas not on screen');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height - 20);
  await page.mouse.wheel(0, top.y - (canvas.y + margin));
  await expect.poll(async () => (await topCard.boundingBox())?.y).toBeGreaterThanOrEqual(canvas.y + margin - 2);
}

function encode(name: string, video: string, startSec: number, endSec: number, crop: Crop) {
  mkdirSync(OUT_DIR, { recursive: true });
  const even = (n: number) => Math.round(n) - (Math.round(n) % 2);
  const box = `crop=${even(crop.width)}:${even(crop.height)}:${Math.max(0, Math.round(crop.x))}:${Math.max(0, Math.round(crop.y))}`;
  const clipPath = join(OUT_DIR, `${name}.webp`);
  const posterPath = join(OUT_DIR, `${name}.poster.webp`);
  const quiet = ['-y', '-hide_banner', '-loglevel', 'error'];
  execFileSync('ffmpeg', [
    ...quiet, '-ss', String(startSec), '-to', String(endSec), '-i', video,
    '-vf', `${box},fps=${FPS}`, '-an', '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '60', '-compression_level', '6', '-loop', '0', clipPath
  ]);
  // The poster is the result of the action, so a paused clip still shows it.
  execFileSync('ffmpeg', [
    ...quiet, '-ss', String(endSec - 0.4), '-i', video,
    '-frames:v', '1', '-vf', box, '-c:v', 'libwebp', '-q:v', '75', posterPath
  ]);
  const kb = (p: string) => Math.round(statSync(p).size / 1024);
  console.log(`${name}: ${even(crop.width)}x${even(crop.height)}, ${(endSec - startSec).toFixed(1)}s, ${kb(clipPath)} KB, poster ${kb(posterPath)} KB`);
}

export function clip(name: string, seed: SeedBoard, body: (c: Clip) => Promise<void>) {
  test(name, async ({ browser }) => {
    const { state, url } = await createBoard(browser, seed);
    const videoDir = RECORD ? mkdtempSync(join(tmpdir(), 'guide-clip-')) : null;
    let ctx: BrowserContext | null = null;
    try {
      ctx = await browser.newContext({
        viewport: VIEWPORT,
        storageState: state,
        ...(videoDir ? { recordVideo: { dir: videoDir, size: VIEWPORT } } : {})
      });
      const page = await ctx.newPage();
      await page.addInitScript(installCursor);
      const opened = Date.now();
      await page.goto(url);
      await expect(page.getByTestId('board-canvas')).toBeVisible();
      await dismissTips(page);

      let startMs: number | null = null;
      let region: Crop | null = null;
      await body({
        page,
        card: (text) => page.getByTestId('canvas-card').filter({ hasText: text }),
        action: () => (startMs = Date.now() - opened),
        crop: (r) => (region = r)
      });
      await page.waitForTimeout(HOLD_LAST_FRAME_MS);
      const endMs = Date.now() - opened;

      if (!startMs || !region) throw new Error(`${name} must call action() and crop()`);
      if (videoDir) {
        const video = await page.video()!.path();
        await ctx.close();
        ctx = null;
        encode(name, video, startMs / 1000, endMs / 1000, region);
      }
    } finally {
      await ctx?.close();
      if (videoDir) rmSync(videoDir, { recursive: true, force: true });
    }
  });
}
