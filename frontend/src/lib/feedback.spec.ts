import { describe, expect, it } from 'vitest';
import { browserSummary, feedbackHref, shortVersion } from './feedback';

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
  const base = 'https://github.com/5cotts/fast-retro/issues/new?template=bug.yml';

  it('adds the version and browser as prefill parameters', () => {
    const href = new URL(feedbackHref(base, { version: 'c9c5238a1b2c3d4e', userAgent: CHROME_MAC }));
    expect(href.origin + href.pathname).toBe('https://github.com/5cotts/fast-retro/issues/new');
    expect(href.searchParams.get('template')).toBe('bug.yml');
    expect(href.searchParams.get('version')).toBe('c9c5238');
    expect(href.searchParams.get('browser')).toBe('Chrome 130 on macOS');
  });

  it('adds nothing else', () => {
    const href = new URL(feedbackHref(base, { version: 'c9c5238a1b2c3d4e', userAgent: CHROME_MAC }));
    expect([...href.searchParams.keys()].sort()).toEqual(['browser', 'template', 'version']);
  });

  it('leaves the link alone when there is nothing to add', () => {
    expect(feedbackHref(base)).toBe(base);
    expect(feedbackHref(base, { version: 'dev', userAgent: 'curl/8.0' })).toBe(base);
  });

  it('returns a value it cannot parse unchanged', () => {
    expect(feedbackHref('not a url', { version: 'c9c5238a1b2c3d4e' })).toBe('not a url');
  });
});
