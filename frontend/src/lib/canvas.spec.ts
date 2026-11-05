import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CARD_SLOT_HEIGHT,
  DEFAULT_VIEW,
  MAX_ZOOM,
  MIN_ZOOM,
  WORLD_LIMIT,
  boundsOf,
  compareStack,
  fitToBounds,
  cardSlotHeight,
  centerOn,
  gridSlots,
  nextZ,
  panToReveal,
  rankByVotes,
  readLayout,
  sanitizePos,
  screenToWorld,
  worldToScreen,
  zoomAt
} from './canvas';
import { addCard, addComment, applyBoardEdit, moveCard, readCards, setCardPos, toggleVote } from './yboard';
import { cardToY } from './cardcodec';
import { phaseHint } from './phase';
import { readColumns } from './columns';
import type { CardData } from './types';

describe('sanitizePos', () => {
  it('keeps a valid position', () => {
    expect(sanitizePos({ x: 10.5, y: -3, z: 2 })).toEqual({ x: 10.5, y: -3, z: 2 });
  });

  it('treats anything else as unmoved', () => {
    for (const raw of [undefined, null, 'x', 7, [], {}, { x: 1 }, { x: 'a', y: 1, z: 1 }, { x: NaN, y: 1, z: 1 }, { x: 1, y: Infinity, z: 1 }]) {
      expect(sanitizePos(raw)).toBeNull();
    }
  });

  it('clamps to the bounded world', () => {
    expect(sanitizePos({ x: 1e9, y: -1e9, z: 1 })).toEqual({ x: WORLD_LIMIT, y: -WORLD_LIMIT, z: 1 });
  });

  it('defaults a missing or negative z, and caps a huge one', () => {
    expect(sanitizePos({ x: 1, y: 1 })?.z).toBe(0);
    expect(sanitizePos({ x: 1, y: 1, z: -5 })?.z).toBe(0);
    expect(sanitizePos({ x: 1, y: 1, z: 1e30 })?.z).toBe(1_000_000_000);
  });
});

describe('starting grid', () => {
  it('stacks a column under its heading and keeps columns apart', () => {
    const [first, second] = gridSlots(0, [CARD_SLOT_HEIGHT, CARD_SLOT_HEIGHT]);
    expect(second.x).toBe(first.x);
    expect(second.y - first.y).toBe(CARD_SLOT_HEIGHT);
    expect(gridSlots(1, [])[0].x).toBeGreaterThan(first.x);
  });

  it('ends with the next free slot', () => {
    const slots = gridSlots(0, [200, 300]);
    expect(slots).toHaveLength(3);
    expect(slots[2].y - slots[0].y).toBe(500);
  });

  it('leaves room for a long card, and treats short ones alike', () => {
    expect(cardSlotHeight('short')).toBe(CARD_SLOT_HEIGHT);
    expect(cardSlotHeight('a line that wraps once')).toBe(CARD_SLOT_HEIGHT);
    expect(cardSlotHeight('x'.repeat(260))).toBeGreaterThan(CARD_SLOT_HEIGHT + 100);
    expect(cardSlotHeight('1\n2\n3\n4\n5\n6')).toBeGreaterThan(CARD_SLOT_HEIGHT);
  });
});

describe('view math', () => {
  const views = [DEFAULT_VIEW, { panX: 100, panY: -40, zoom: 0.5 }, { panX: -7, panY: 13, zoom: 1.75 }, { panX: 0, panY: 0, zoom: MIN_ZOOM }];

  it('round-trips screen and world at several zooms', () => {
    for (const view of views) {
      const world = screenToWorld(view, worldToScreen(view, { x: 321, y: -123 }));
      expect(world.x).toBeCloseTo(321);
      expect(world.y).toBeCloseTo(-123);
    }
  });

  it('keeps the point under the pointer when zooming', () => {
    for (const view of views) {
      const at = { x: 400, y: 250 };
      const anchor = screenToWorld(view, at);
      const screen = worldToScreen(zoomAt(view, at, view.zoom * 1.3), anchor);
      expect(screen.x).toBeCloseTo(at.x);
      expect(screen.y).toBeCloseTo(at.y);
    }
  });

  it('limits zoom', () => {
    expect(zoomAt(DEFAULT_VIEW, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(DEFAULT_VIEW, { x: 0, y: 0 }, 0.001).zoom).toBe(MIN_ZOOM);
  });
});

describe('fit', () => {
  const viewport = { width: 1000, height: 600 };

  it('shows the whole bounds, centered', () => {
    const bounds = { x: -500, y: 100, width: 3000, height: 1000 };
    const view = fitToBounds(bounds, viewport);
    const topLeft = worldToScreen(view, { x: bounds.x, y: bounds.y });
    const bottomRight = worldToScreen(view, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(viewport.width);
    expect(bottomRight.y).toBeLessThanOrEqual(viewport.height);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(viewport.width / 2);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(viewport.height / 2);
  });

  it('never zooms past 100% for a small board', () => {
    expect(fitToBounds({ x: 0, y: 0, width: 10, height: 10 }, viewport).zoom).toBe(1);
  });

  it('stops at the zoom limit for a huge board', () => {
    expect(fitToBounds({ x: 0, y: 0, width: 40_000, height: 40_000 }, viewport).zoom).toBe(MIN_ZOOM);
  });

  it('falls back to the default view with nothing to fit or no room', () => {
    expect(fitToBounds(null, viewport)).toEqual(DEFAULT_VIEW);
    expect(fitToBounds({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual(DEFAULT_VIEW);
  });

  it('computes bounds from rectangles', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 10, y: 20, width: 5, height: 5 },
        { x: -10, y: 40, width: 5, height: 5 }
      ])
    ).toEqual({ x: -10, y: 20, width: 25, height: 25 });
  });
});

describe('stacking', () => {
  it('puts a dropped card on top', () => {
    expect(nextZ([])).toBe(1);
    expect(nextZ([null, undefined, { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 2 }])).toBe(5);
  });

  it('orders by z, then card ID', () => {
    const order = [
      { id: 'b', z: 1 },
      { id: 'a', z: 1 },
      { id: 'z', z: 0 },
      { id: 'c', z: 2 }
    ].sort(compareStack);
    expect(order.map((c) => c.id)).toEqual(['z', 'a', 'b', 'c']);
  });
});

// Two clients, synced by hand: updates held back until sync() models concurrency.
function twoDocs() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  };
  const card: CardData = { id: 'c1', text: 'Card', authorId: 'u', votes: [], reactions: {}, comments: [] };
  const col = new Y.Array<Y.Map<unknown>>();
  a.getMap<Y.Array<Y.Map<unknown>>>('board').set('col', col);
  col.push([cardToY(card), cardToY({ ...card, id: 'c2' })]);
  sync();
  return {
    a,
    b,
    sync,
    boardA: a.getMap<Y.Array<Y.Map<unknown>>>('board'),
    boardB: b.getMap<Y.Array<Y.Map<unknown>>>('board')
  };
}

describe('positions in the doc', () => {
  it('concurrent drops of one card converge on one position', () => {
    const { sync, boardA, boardB } = twoDocs();
    setCardPos(boardA, 'col', 'c1', { x: 1, y: 1, z: 1 });
    setCardPos(boardB, 'col', 'c1', { x: 2, y: 2, z: 1 });
    sync();
    const a = readCards(boardA, 'col');
    expect(a).toEqual(readCards(boardB, 'col'));
    expect(a).toHaveLength(2);
    expect([1, 2]).toContain(a[0].pos?.x);
    expect(a[0].pos?.x).toBe(a[0].pos?.y);
  });

  it('concurrent drops of different cards agree on which is on top', () => {
    const { sync, boardA, boardB } = twoDocs();
    setCardPos(boardA, 'col', 'c1', { x: 0, y: 0, z: nextZ([]) });
    setCardPos(boardB, 'col', 'c2', { x: 0, y: 0, z: nextZ([]) });
    sync();
    const stack = (board: typeof boardA) =>
      readCards(board, 'col')
        .map((c) => ({ id: c.id, z: c.pos!.z }))
        .sort(compareStack)
        .map((c) => c.id);
    expect(stack(boardA)).toEqual(stack(boardB));
    expect(stack(boardA)).toEqual(['c1', 'c2']);
  });

  it('a move and a concurrent comment and vote all survive', () => {
    const { sync, boardA, boardB } = twoDocs();
    setCardPos(boardA, 'col', 'c1', { x: 50, y: 60, z: 1 });
    addComment(boardB, 'col', 'c1', 'Nice', 'u2');
    toggleVote(boardB, 'col', 'c1', 'u2');
    sync();
    const card = readCards(boardA, 'col')[0];
    expect(card.pos).toEqual({ x: 50, y: 60, z: 1 });
    expect(card.comments.map((c) => c.text)).toEqual(['Nice']);
    expect(card.votes).toEqual(['u2']);
    expect(readCards(boardB, 'col')).toEqual(readCards(boardA, 'col'));
  });

  it('writes one small update per drop, and never rebuilds the card', () => {
    const { a, boardA } = twoDocs();
    const before = boardA.get('col')!.get(0);
    let updates = 0;
    let bytes = 0;
    a.on('update', (u: Uint8Array) => {
      updates++;
      bytes += u.length;
    });
    setCardPos(boardA, 'col', 'c1', { x: 1, y: 2, z: 3 });
    expect(updates).toBe(1);
    expect(bytes).toBeLessThan(100);
    expect(boardA.get('col')!.get(0)).toBe(before);
  });

  it('ignores a card or column that is not there', () => {
    const { boardA } = twoDocs();
    setCardPos(boardA, 'col', 'nope', { x: 1, y: 2, z: 3 });
    setCardPos(boardA, 'nope', 'c1', { x: 1, y: 2, z: 3 });
    expect(readCards(boardA, 'col').every((c) => !c.pos)).toBe(true);
  });

  it('keeps a position through moveCard, which rebuilds the card', () => {
    const { a, boardA } = twoDocs();
    setCardPos(boardA, 'col', 'c1', { x: 5, y: 6, z: 7 });
    moveCard(a, boardA, 'col', 'c1', 'col', null);
    expect(readCards(boardA, 'col').map((c) => [c.id, c.pos])).toEqual([
      ['c2', undefined],
      ['c1', { x: 5, y: 6, z: 7 }]
    ]);
  });

  it('removing a prompt removes its cards, positions and all', () => {
    const doc = new Y.Doc();
    const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
    const meta = doc.getMap<unknown>('meta');
    const phase = doc.getMap<unknown>('phase');
    const columns = [
      { key: 'p1', title: 'One', color: 'amber' as const },
      { key: 'p2', title: 'Two', color: 'rose' as const }
    ];
    applyBoardEdit({ doc, board, meta, phase }, { columns });
    board.get('p1')!.push([cardToY({ id: 'c', text: 't', authorId: '', votes: [], reactions: {}, comments: [], pos: { x: 1, y: 1, z: 1 } })]);
    applyBoardEdit({ doc, board, meta, phase }, { columns: [columns[1]] });
    expect(readCards(board, 'p1')).toEqual([]);
    expect(readColumns(meta).map((c) => c.key)).toEqual(['p2']);
  });

  it('reads the layout, treating anything unknown as columns', () => {
    const meta = new Y.Doc().getMap<unknown>('meta');
    expect(readLayout(meta)).toBe('columns');
    meta.set('layout', 'spiral');
    expect(readLayout(meta)).toBe('columns');
    meta.set('layout', 'canvas');
    expect(readLayout(meta)).toBe('canvas');
  });
});

describe('panToReveal', () => {
  const viewport = { width: 800, height: 600 };
  const rect = { x: 0, y: 0, width: 260, height: 190 };

  it('leaves the view alone when the rect is already on screen', () => {
    const view = { panX: 100, panY: 100, zoom: 1 };
    expect(panToReveal(view, rect, viewport)).toEqual(view);
  });

  it('pans the least it can, from any side', () => {
    expect(panToReveal({ panX: 0, panY: 0, zoom: 1 }, { ...rect, y: 1000 }, viewport).panY).toBe(600 - 16 - 1190);
    expect(panToReveal({ panX: 0, panY: 0, zoom: 1 }, { ...rect, x: 2000 }, viewport).panX).toBe(800 - 16 - 2260);
    expect(panToReveal({ panX: 500, panY: 500, zoom: 1 }, rect, viewport)).toMatchObject({ panX: 500, panY: 394 });
    expect(panToReveal({ panX: -500, panY: 100, zoom: 1 }, rect, viewport)).toMatchObject({ panX: 16, panY: 100 });
  });

  it('works in screen pixels at any zoom, and keeps the zoom', () => {
    const view = panToReveal({ panX: 0, panY: 0, zoom: 0.5 }, { ...rect, y: 2000 }, viewport);
    expect(view.zoom).toBe(0.5);
    expect(worldToScreen(view, { x: 0, y: 2000 + 190 }).y).toBe(600 - 16);
  });

  it('lines up with the top-left of a rect too big for the viewport', () => {
    const view = panToReveal({ panX: 0, panY: 0, zoom: 2 }, { ...rect, y: 1000, height: 500 }, viewport);
    expect(worldToScreen(view, { x: 0, y: 1000 }).y).toBe(16);
  });
});

describe('centerOn', () => {
  it('puts the middle of the rect in the middle of the viewport, at any zoom', () => {
    const rect = { x: 900, y: -300, width: 260, height: 190 };
    const viewport = { width: 800, height: 600 };
    for (const zoom of [0.5, 1, 1.75]) {
      const view = centerOn({ panX: 11, panY: 22, zoom }, rect, viewport);
      expect(view.zoom).toBe(zoom);
      expect(worldToScreen(view, { x: 900 + 130, y: -300 + 95 })).toEqual({ x: 400, y: 300 });
    }
  });
});

describe('rankByVotes', () => {
  const card = (id: string, votes: number) => ({ id, votes: Array.from({ length: votes }, (_, i) => `u${i}`) });

  it('leaves out cards with no votes and puts the most votes first', () => {
    const ranked = rankByVotes([card('a', 1), card('b', 0), card('c', 3)]);
    expect(ranked.map((c) => c.id)).toEqual(['c', 'a']);
  });

  it('keeps the given order for a tie, and leaves its input alone', () => {
    const cards = [card('a', 2), card('b', 2), card('c', 2)];
    expect(rankByVotes(cards).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('addCard on a canvas', () => {
  it('stores a position when given one, and none otherwise', () => {
    const doc = new Y.Doc();
    const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
    board.set('ok', new Y.Array<Y.Map<unknown>>());
    addCard(board, 'ok', 'placed', 'u', { x: 40, y: 50, z: 3 });
    addCard(board, 'ok', 'slotted', 'u');
    const cards = readCards(board, 'ok');
    expect(cards[0].pos).toEqual({ x: 40, y: 50, z: 3 });
    expect(cards[1]).not.toHaveProperty('pos');
  });
});

describe('phaseHint', () => {
  it('tells each view what it can do', () => {
    expect(phaseHint('group', 'columns')).toMatch(/onto another/);
    expect(phaseHint('group', 'canvas')).toMatch(/near each other/);
    expect(phaseHint('group', 'list')).toMatch(/Switch to Canvas/);
    expect(phaseHint('vote', 'list')).toBe(phaseHint('vote', 'columns'));
  });
});
