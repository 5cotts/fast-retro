import { describe, expect, it } from 'vitest';
import { adjacentGuidePages, boardGuidePath, GUIDE_PAGES, guidePageFor, guidePath, legacyGuideRedirect } from './pages';

describe('guide pages', () => {
  it('has 8 pages with unique slugs', () => {
    expect(GUIDE_PAGES).toHaveLength(8);
    expect(new Set(GUIDE_PAGES.map((p) => p.slug)).size).toBe(8);
  });

  it('finds a page by path, with or without a trailing slash', () => {
    expect(guidePageFor('/docs/canvas')?.slug).toBe('canvas');
    expect(guidePageFor('/docs/canvas/')?.slug).toBe('canvas');
    expect(guidePageFor('/docs')).toBeNull();
    expect(guidePageFor('/docs/nope')).toBeNull();
  });

  it('links previous and next in list order, with none past either end', () => {
    expect(adjacentGuidePages('join').previous).toBeNull();
    expect(adjacentGuidePages('join').next?.slug).toBe('run');
    expect(adjacentGuidePages('run').previous?.slug).toBe('join');
    expect(adjacentGuidePages('reference').next).toBeNull();
  });

  it('picks the board link by layout, columns and role', () => {
    for (const isHost of [true, false]) {
      expect(boardGuidePath({ layout: 'canvas', customColumns: true, isHost })).toBe('/docs/canvas');
      expect(boardGuidePath({ layout: 'columns', customColumns: false, isHost })).toBeNull();
    }
    expect(boardGuidePath({ layout: 'columns', customColumns: true, isHost: true })).toBe('/docs/setup');
    expect(boardGuidePath({ layout: 'columns', customColumns: true, isHost: false })).toBe('/docs/join');
  });

  it('sends the old role links to the matching page', () => {
    expect(legacyGuideRedirect('lead')).toBe(guidePath('run'));
    expect(legacyGuideRedirect('participant')).toBe(guidePath('join'));
    expect(legacyGuideRedirect(null)).toBeNull();
    expect(legacyGuideRedirect('other')).toBeNull();
  });
});
