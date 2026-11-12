import { describe, expect, it } from 'vitest';
import {
  includesMine,
  isMine,
  isPresenting,
  isPresentingUrl,
  selfViewer,
  viewerFor,
  viewerId,
  withPresenting,
  type Viewer
} from './viewer';

const me = selfViewer('me');
const presenting: Viewer = { kind: 'presenting' };

describe('isMine', () => {
  it('matches your own id', () => {
    expect(isMine(me, 'me')).toBe(true);
    expect(isMine(me, 'them')).toBe(false);
  });

  it('never matches an empty author id', () => {
    expect(isMine(me, '')).toBe(false);
    expect(isMine(selfViewer(''), '')).toBe(false);
  });

  it('matches nothing while presenting', () => {
    expect(isMine(presenting, 'me')).toBe(false);
    expect(isMine(presenting, '')).toBe(false);
  });
});

describe('includesMine', () => {
  it('finds your id in a list', () => {
    expect(includesMine(me, ['them', 'me'])).toBe(true);
    expect(includesMine(me, ['them'])).toBe(false);
    expect(includesMine(me, [])).toBe(false);
  });

  it('never matches an empty id', () => {
    expect(includesMine(selfViewer(''), [''])).toBe(false);
  });

  it('finds nothing while presenting', () => {
    expect(includesMine(presenting, ['me'])).toBe(false);
  });
});

describe('viewerId', () => {
  it('is the id for yourself and null while presenting', () => {
    expect(viewerId(me)).toBe('me');
    expect(viewerId(presenting)).toBeNull();
  });
});

describe('viewerFor', () => {
  it('is you unless presenting', () => {
    expect(viewerFor('me', false)).toEqual(me);
    expect(viewerFor('me', true)).toEqual(presenting);
    expect(isPresenting(viewerFor('me', true))).toBe(true);
    expect(isPresenting(viewerFor('me', false))).toBe(false);
  });
});

describe('presenting in the URL', () => {
  const board = new URL('https://retro.example/board/abc');

  it('adds a bare ?present and removes it again', () => {
    const on = withPresenting(board, true);
    expect(on.href).toBe('https://retro.example/board/abc?present');
    expect(isPresentingUrl(on)).toBe(true);
    const off = withPresenting(on, false);
    expect(off.href).toBe('https://retro.example/board/abc');
    expect(isPresentingUrl(off)).toBe(false);
  });

  it('leaves other params and the hash alone', () => {
    const url = new URL('https://retro.example/board/abc?x=1#top');
    expect(withPresenting(url, true).href).toBe('https://retro.example/board/abc?x=1&present#top');
    expect(withPresenting(withPresenting(url, true), false).href).toBe(url.href);
  });

  it('reads any form of the param and never duplicates it', () => {
    const url = new URL('https://retro.example/board/abc?present=1');
    expect(isPresentingUrl(url)).toBe(true);
    expect(withPresenting(url, true).href).toBe('https://retro.example/board/abc?present');
  });

  it('does not change the URL it was given', () => {
    withPresenting(board, true);
    expect(board.href).toBe('https://retro.example/board/abc');
  });
});
