import { describe, expect, it } from 'vitest';
import { browserSummary, feedbackHref, shortVersion, validBoardRef } from './feedback';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

describe('browserSummary', () => {
  it('names the browser and system, nothing finer', () => {
    expect(browserSummary(CHROME_MAC)).toBe('Chrome 130 on macOS');
    expect(browserSummary(EDGE_WIN)).toBe('Edge 130 on Windows');
    expect(browserSummary(FIREFOX_LINUX)).toBe('Firefox 132 on Linux');
    expect(browserSummary(SAFARI_IPHONE)).toBe('Safari 17 on iOS');
    expect(browserSummary(CHROME_ANDROID)).toBe('Chrome 130 on Android');
  });

  it('returns null for anything it does not recognise', () => {
    expect(browserSummary('')).toBeNull();
    expect(browserSummary('curl/8.0')).toBeNull();
  });
});

describe('shortVersion', () => {
  it('shortens a commit sha and keeps the dirty marker', () => {
    expect(shortVersion('c9c5238a1b2c3d4e5f60718293a4b5c6d7e8f901')).toBe('c9c5238');
    expect(shortVersion('c9c5238a1b2c3d4e5f60718293a4b5c6d7e8f901-dirty')).toBe('c9c5238-dirty');
  });

  it('drops anything that is not a sha', () => {
    expect(shortVersion('dev')).toBeNull();
    expect(shortVersion('')).toBeNull();
    expect(shortVersion(null)).toBeNull();
    expect(shortVersion('<script>alert(1)</script>')).toBeNull();
  });
});

describe('feedbackHref', () => {
  const base = 'https://github.com/5cotts/fast-retro/issues/new';
  const ctx = { version: 'c9c5238a1b2c3d4e', userAgent: CHROME_MAC, boardRef: '7f3a-9c1e-b204' };
  const keys = (href: string) => [...new URL(href).searchParams.keys()].sort();

  it('opens the bug form with the build, browser and board reference filled in', () => {
    const href = new URL(feedbackHref(base, 'bug', ctx));
    expect(href.origin + href.pathname).toBe('https://github.com/5cotts/fast-retro/issues/new');
    expect(href.searchParams.get('template')).toBe('bug.yml');
    expect(href.searchParams.get('version')).toBe('c9c5238');
    expect(href.searchParams.get('browser')).toBe('Chrome 130 on macOS');
    expect(href.searchParams.get('board_ref')).toBe('7f3a-9c1e-b204');
    expect(keys(href.toString())).toEqual(['board_ref', 'browser', 'template', 'version']);
  });

  it('opens the feature form with only the board reference', () => {
    const href = new URL(feedbackHref(base, 'feature', ctx));
    expect(href.searchParams.get('template')).toBe('feature.yml');
    expect(href.searchParams.get('board_ref')).toBe('7f3a-9c1e-b204');
    expect(keys(href.toString())).toEqual(['board_ref', 'template']);
  });

  it('adds no board reference off a board', () => {
    const { boardRef: _unused, ...offBoard } = ctx;
    expect(keys(feedbackHref(base, 'bug', offBoard))).toEqual(['browser', 'template', 'version']);
    expect(keys(feedbackHref(base, 'feature', offBoard))).toEqual(['template']);
  });

  it('never lets anything but a reference through as board_ref', () => {
    for (const bad of ['my-retro-slug', 'https://x.test/board/abc', '7f3a-9c1e-b20', '7F3A-9C1E-B204', '']) {
      for (const kind of ['bug', 'feature'] as const) {
        expect(new URL(feedbackHref(base, kind, { boardRef: bad })).searchParams.has('board_ref')).toBe(false);
      }
    }
  });

  it('adds only the form when there is nothing else to add', () => {
    expect(feedbackHref(base, 'bug')).toBe(`${base}?template=bug.yml`);
    expect(feedbackHref(base, 'bug', { version: 'dev', userAgent: 'curl/8.0' })).toBe(`${base}?template=bug.yml`);
  });

  it('returns a value it cannot parse unchanged', () => {
    expect(feedbackHref('not a url', 'bug', { version: 'c9c5238a1b2c3d4e' })).toBe('not a url');
  });
});
