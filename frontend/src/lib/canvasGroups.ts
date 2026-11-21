import { CARD_SLOT_HEIGHT, CARD_WIDTH, overlapsAny, type Point, type Rect, type Size } from './canvas';

// Groups on a canvas: a box that holds its cards, with one position. The rules
// here have no DOM or Yjs in them, so they're unit-tested; CanvasSurface asks
// the DOM what's under the pointer and carries the answer out.

// The box's own spacing: the border, the padding and the gap between cards.
export const GROUP_PADDING = 8;
export const GROUP_BORDER = 2;
export const GROUP_GAP = 8;
// A group's header (name, counts, Ungroup, Merge). Fit uses it, so it only has
// to be about right; the browser lays out the real thing.
export const GROUP_HEADER_HEIGHT = 40;
// How far from a box a card lands when it leaves one.
export const LEAVE_GAP = 24;

// How many cards sit side by side in a box.
export function groupColumns(count: number): number {
  return count <= 1 ? 1 : count <= 4 ? 2 : 3;
}

// The size of a box holding cards of these heights, from the same estimate the
// starting grid uses. For Fit only.
export function groupBoxSize(heights: readonly number[]): Size {
  const cols = groupColumns(heights.length);
  const rows: number[] = [];
  heights.forEach((h, i) => {
    const row = Math.floor(i / cols);
    rows[row] = Math.max(rows[row] ?? 0, h);
  });
  const body = rows.reduce((sum, h) => sum + h, 0) + Math.max(0, rows.length - 1) * GROUP_GAP;
  const inner = (GROUP_PADDING + GROUP_BORDER) * 2;
  return {
    width: cols * CARD_WIDTH + (cols - 1) * GROUP_GAP + inner,
    height: GROUP_HEADER_HEIGHT + body + inner
  };
}

// What's under the pointer during a drag. A card in a group counts as its
// group; a card that is the only one in an unnamed group counts as a loose
// card, and carries that group with it.
export type DropOver =
  | { kind: 'card'; id: string; clusterId: string | null }
  | { kind: 'group'; id: string }
  | null;

export interface DragSource {
  id: string;
  // The group the card is drawn inside, if any (a box, not a lone card).
  groupId: string | null;
  // Any group the card belongs to, including the invisible one a lone card has.
  clusterId: string | null;
}

export type CanvasDropPlan =
  // Dropped where it was, or on its own group: nothing to write.
  | { kind: 'none' }
  // Put the card here, on top. If it was in a group, it leaves.
  | { kind: 'place'; at: Point; leaves: boolean }
  // Join this group.
  | { kind: 'join'; clusterId: string }
  // Make a group of the target and this card, where the target was. A target
  // that already has a lone group of its own keeps it.
  | { kind: 'group-with'; targetId: string; clusterId: string | null };

// Every rule for what a drop does on a canvas. Grouping only happens in the
// Group phase (`canGroup`), and only for a drop that lands on a card or a box.
// A drop beside one just places the card, so nearness is still how cards are
// piled without grouping.
export function planCanvasDrop(source: DragSource, over: DropOver, at: Point, canGroup: boolean): CanvasDropPlan {
  // Outside Group, a card inside a box stays in it: its drop changes nothing.
  if (!canGroup) return source.groupId ? { kind: 'none' } : { kind: 'place', at, leaves: false };

  if (over?.kind === 'group') {
    return over.id === source.groupId ? { kind: 'none' } : { kind: 'join', clusterId: over.id };
  }
  if (over?.kind === 'card' && over.id !== source.id) {
    return { kind: 'group-with', targetId: over.id, clusterId: over.clusterId };
  }
  return { kind: 'place', at, leaves: source.clusterId !== null };
}

// The nearest spot to the right of `from` where a card of `size` touches
// nothing, trying further right and then lower. Used when a card leaves a box
// by menu, so it doesn't land on top of the next group. Falls back to the
// first choice on a board too crowded to find a gap.
export function freeSpotBeside(from: Rect, size: Size, obstacles: readonly Rect[], gap = LEAVE_GAP): Point {
  const first = { x: from.x + from.width + gap, y: from.y };
  const stepX = size.width + gap;
  const stepY = Math.max(size.height, CARD_SLOT_HEIGHT) + gap;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const spot = { x: first.x + col * stepX, y: first.y + row * stepY };
      if (!overlapsAny({ ...spot, ...size }, obstacles)) return spot;
    }
  }
  return first;
}

// One line of the Top voted panel: a loose card, or a whole group.
export interface TopVotedItem<Color extends string = string> {
  id: string;
  kind: 'card' | 'group';
  text: string;
  // People who voted. For a card that's its votes; for a group it's the
  // different people who voted on any card in it, so a five-card group can't
  // outrank a two-card one just for having more cards.
  votes: number;
  // A card's prompt color. A group has none.
  color: Color | null;
  // Only for a group: how many cards it holds.
  cards?: number;
}

// Most voted first. Equal counts keep the order given, with groups before
// cards, so the list doesn't shuffle as ties come and go. Cards inside a group
// aren't listed on their own: the group stands for them.
export function topVotedItems<Color extends string>(
  cards: readonly { id: string; text: string; votes: readonly string[]; color: Color }[],
  groups: readonly { id: string; name: string; cards: number; voters: number }[]
): TopVotedItem<Color>[] {
  const rows: TopVotedItem<Color>[] = [
    ...groups.filter((g) => g.voters > 0).map((g) => ({ id: g.id, kind: 'group' as const, text: g.name, votes: g.voters, color: null, cards: g.cards })),
    ...cards.filter((c) => c.votes.length > 0).map((c) => ({ id: c.id, kind: 'card' as const, text: c.text, votes: c.votes.length, color: c.color }))
  ];
  return rows.sort((a, b) => b.votes - a.votes);
}
