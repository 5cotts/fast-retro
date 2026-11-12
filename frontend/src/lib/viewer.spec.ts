import { describe, expect, it } from 'vitest';
import { includesMine, isMine, selfViewer, viewerId, type Viewer } from './viewer';

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
