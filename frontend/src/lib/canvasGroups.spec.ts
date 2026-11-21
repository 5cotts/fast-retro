import { describe, expect, it } from 'vitest';
import { CARD_SLOT_HEIGHT, CARD_WIDTH } from './canvas';
import {
  GROUP_BORDER,
  GROUP_GAP,
  GROUP_HEADER_HEIGHT,
  GROUP_PADDING,
  freeSpotBeside,
  groupBoxSize,
  groupColumns,
  planCanvasDrop,
  type DragSource
} from './canvasGroups';

const AT = { x: 100, y: 200 };
const loose: DragSource = { id: 'a', groupId: null, clusterId: null };
const inBox: DragSource = { id: 'a', groupId: 'g1', clusterId: 'g1' };
const lone: DragSource = { id: 'a', groupId: null, clusterId: 'solo' };

describe('planCanvasDrop', () => {
  it('on a loose card in Group makes a group where that card is', () => {
    expect(planCanvasDrop(loose, { kind: 'card', id: 'b', clusterId: null }, AT, true)).toEqual({
      kind: 'group-with',
      targetId: 'b',
      clusterId: null
    });
  });

  it('on a lone card joins the group that card already has', () => {
    expect(planCanvasDrop(loose, { kind: 'card', id: 'b', clusterId: 'solo' }, AT, true)).toEqual({
      kind: 'group-with',
      targetId: 'b',
      clusterId: 'solo'
    });
  });

  it('on a group joins it', () => {
    expect(planCanvasDrop(loose, { kind: 'group', id: 'g2' }, AT, true)).toEqual({ kind: 'join', clusterId: 'g2' });
    expect(planCanvasDrop(inBox, { kind: 'group', id: 'g2' }, AT, true)).toEqual({ kind: 'join', clusterId: 'g2' });
  });

  it('on its own group changes nothing', () => {
    expect(planCanvasDrop(inBox, { kind: 'group', id: 'g1' }, AT, true)).toEqual({ kind: 'none' });
  });

  it('on itself only places it', () => {
    expect(planCanvasDrop(loose, { kind: 'card', id: 'a', clusterId: null }, AT, true)).toEqual({
      kind: 'place',
      at: AT,
      leaves: false
    });
  });

  it('anywhere else places the card, and takes it out of its group', () => {
    expect(planCanvasDrop(loose, null, AT, true)).toEqual({ kind: 'place', at: AT, leaves: false });
    expect(planCanvasDrop(inBox, null, AT, true)).toEqual({ kind: 'place', at: AT, leaves: true });
    expect(planCanvasDrop(lone, null, AT, true)).toEqual({ kind: 'place', at: AT, leaves: true });
  });

  it('outside Group a drop only places a loose card, whatever is under it', () => {
    const on = { kind: 'card', id: 'b', clusterId: null } as const;
    expect(planCanvasDrop(loose, on, AT, false)).toEqual({ kind: 'place', at: AT, leaves: false });
    expect(planCanvasDrop(loose, { kind: 'group', id: 'g2' }, AT, false)).toEqual({ kind: 'place', at: AT, leaves: false });
    expect(planCanvasDrop(lone, on, AT, false)).toEqual({ kind: 'place', at: AT, leaves: false });
  });

  it('outside Group a card in a box stays in it', () => {
    expect(planCanvasDrop(inBox, null, AT, false)).toEqual({ kind: 'none' });
    expect(planCanvasDrop(inBox, { kind: 'group', id: 'g2' }, AT, false)).toEqual({ kind: 'none' });
  });
});

describe('group box size', () => {
  it('uses one column for one card, two up to four, three beyond', () => {
    expect([0, 1, 2, 4, 5, 9].map(groupColumns)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('adds up rows of the tallest card in each, plus the header and padding', () => {
    const inner = (GROUP_PADDING + GROUP_BORDER) * 2;
    expect(groupBoxSize([300])).toEqual({ width: CARD_WIDTH + inner, height: GROUP_HEADER_HEIGHT + 300 + inner });
    const four = groupBoxSize([190, 250, 190, 190]);
    expect(four.width).toBe(2 * CARD_WIDTH + GROUP_GAP + inner);
    expect(four.height).toBe(GROUP_HEADER_HEIGHT + 250 + GROUP_GAP + 190 + inner);
  });

  it('is never smaller than the one-card box for an empty list', () => {
    expect(groupBoxSize([]).width).toBe(groupBoxSize([190]).width);
  });
});

describe('freeSpotBeside', () => {
  const from = { x: 0, y: 0, width: 300, height: 400 };
  const size = { width: CARD_WIDTH, height: CARD_SLOT_HEIGHT };

  it('prefers the spot just to the right', () => {
    expect(freeSpotBeside(from, size, [])).toEqual({ x: 324, y: 0 });
  });

  it('skips past a neighbouring box', () => {
    const neighbour = { x: 330, y: 0, width: 300, height: 400 };
    const spot = freeSpotBeside(from, size, [neighbour]);
    expect(spot.x).toBeGreaterThanOrEqual(neighbour.x + neighbour.width);
    expect(spot.y).toBe(0);
  });

  it('moves to a lower row when a whole row is taken', () => {
    const wall = { x: 300, y: -50, width: 10_000, height: 300 };
    const spot = freeSpotBeside(from, size, [wall]);
    expect(spot.y).toBeGreaterThanOrEqual(250);
  });

  it('falls back to the first choice on a board with no gap', () => {
    const everything = { x: -50_000, y: -50_000, width: 100_000, height: 100_000 };
    expect(freeSpotBeside(from, size, [everything])).toEqual({ x: 324, y: 0 });
  });
});
