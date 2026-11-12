import { describe, expect, it } from 'vitest';
import { disambiguateNames, foldPresenting, isSamePerson } from './identity';
import type { PresenceUser } from './types';

describe('isSamePerson', () => {
  it('matches the same name and color', () => {
    expect(isSamePerson({ name: 'Scott', color: '#ef4444' }, { name: 'Scott', color: '#ef4444' })).toBe(true);
  });

  it('ignores case and surrounding spaces in the name', () => {
    expect(isSamePerson({ name: ' scott ', color: '#ef4444' }, { name: 'Scott', color: '#ef4444' })).toBe(true);
  });

  it("doesn't match the same name with a different color", () => {
    expect(isSamePerson({ name: 'Scott', color: '#ef4444' }, { name: 'Scott', color: '#3b82f6' })).toBe(false);
  });

  it("doesn't match a different name with the same color", () => {
    expect(isSamePerson({ name: 'Scott', color: '#ef4444' }, { name: 'Ana', color: '#ef4444' })).toBe(false);
  });
});

function user(clientId: number, name: string, color: string, extra: Partial<PresenceUser> = {}): PresenceUser {
  return { clientId, name, color, isLead: false, ...extra };
}

describe('foldPresenting', () => {
  const tab = user(1, 'Scott', '#ef4444', { isLead: true });
  const popup = user(2, 'Scott', '#ef4444', { isLead: true, presenting: true });
  const ana = user(3, 'Ana', '#3b82f6');

  it('leaves presence alone when nobody is presenting', () => {
    const presence = [tab, ana];
    expect(foldPresenting(presence, 3)).toBe(presence);
  });

  it("folds a host's presenting window into their tab, for everyone else", () => {
    expect(foldPresenting([tab, popup, ana], 3)).toEqual([{ ...tab, presenting: true, typing: null }, ana]);
  });

  it("keeps this client's own entry when it's the presenting window", () => {
    expect(foldPresenting([tab, popup, ana], 2)).toEqual([{ ...popup, typing: null }, ana]);
  });

  it('keeps whichever of the pair is typing', () => {
    const typing = { ...popup, typing: 'card-1' };
    expect(foldPresenting([tab, typing], 3)[0].typing).toBe('card-1');
  });

  it('leaves an unmatched presenting client with its icon', () => {
    const solo = user(1, 'Scott', '#ef4444', { presenting: true });
    expect(foldPresenting([solo, ana], 3)).toEqual([solo, ana]);
  });

  it('never folds two different people who share a name but not a color', () => {
    const other = user(4, 'Scott', '#3b82f6', { presenting: true });
    const out = disambiguateNames(foldPresenting([tab, other], 3));
    expect(out.map((p) => p.name)).toEqual(['Scott', 'Scott (2)']);
  });

  it('shows one name after folding, so there is no "(2)"', () => {
    const out = disambiguateNames(foldPresenting([tab, popup, ana], 3));
    expect(out.map((p) => p.name)).toEqual(['Scott', 'Ana']);
  });
});
