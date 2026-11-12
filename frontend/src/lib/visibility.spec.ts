import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS } from './columns';
import { PHASES } from './phase';
import { isCardHidden, isHidingCards, type VisibilityContext } from './visibility';
import { selfViewer } from './viewer';

const input = DEFAULT_COLUMNS[0];
const actions = DEFAULT_COLUMNS[2];
const custom = { key: 'c-x', title: 'Problem', color: 'violet' as const };
const mine = { authorId: 'me' };
const theirs = { authorId: 'them' };
const ctx = (over: Partial<VisibilityContext> = {}): VisibilityContext => ({
  hideCards: true,
  phase: 'brainstorm',
  ended: false,
  viewer: selfViewer('me'),
  ...over
});

describe('isCardHidden', () => {
  it("hides other people's cards in input columns during Brainstorm", () => {
    expect(isCardHidden(theirs, input, ctx())).toBe(true);
    expect(isCardHidden(theirs, custom, ctx())).toBe(true);
  });

  it('never hides your own cards', () => {
    expect(isCardHidden(mine, input, ctx())).toBe(false);
  });

  it('hides your own cards too while presenting, but not action items', () => {
    const presenting = ctx({ viewer: { kind: 'presenting' } });
    expect(isCardHidden(mine, input, presenting)).toBe(true);
    expect(isCardHidden(mine, actions, presenting)).toBe(false);
    expect(isCardHidden(mine, input, { ...presenting, hideCards: false })).toBe(false);
    expect(isCardHidden(mine, input, { ...presenting, ended: true })).toBe(false);
    expect(isCardHidden(mine, input, { ...presenting, phase: 'group' })).toBe(false);
  });

  it('never hides action items', () => {
    expect(isCardHidden(theirs, actions, ctx())).toBe(false);
  });

  it('shows everything when the setting is off', () => {
    expect(isCardHidden(theirs, input, ctx({ hideCards: false }))).toBe(false);
  });

  it('reveals everything outside Brainstorm', () => {
    for (const phase of PHASES.filter((p) => p !== 'brainstorm')) {
      expect(isCardHidden(theirs, input, ctx({ phase }))).toBe(false);
    }
  });

  it('shows everything on an ended board, even in Brainstorm', () => {
    expect(isCardHidden(theirs, input, ctx({ ended: true }))).toBe(false);
  });

  it('hides cards with no recorded author', () => {
    expect(isCardHidden({ authorId: '' }, input, ctx())).toBe(true);
  });
});

describe('isHidingCards', () => {
  it('is on only while hiding during a live Brainstorm', () => {
    expect(isHidingCards(ctx())).toBe(true);
    expect(isHidingCards(ctx({ phase: 'group' }))).toBe(false);
    expect(isHidingCards(ctx({ ended: true }))).toBe(false);
    expect(isHidingCards(ctx({ hideCards: false }))).toBe(false);
  });
});
