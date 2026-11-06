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
  gridPosition,
  nextZ,
  readLayout,
  sanitizePos,
  screenToWorld,
  worldToScreen,
  zoomAt
} from './canvas';
import { addComment, applyBoardEdit, moveCard, readCards, setCardPos, toggleVote } from './yboard';
import { cardToY } from './cardcodec';
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
    expect(gridPosition(0, 1).x).toBe(gridPosition(0, 0).x);
    expect(gridPosition(0, 1).y - gridPosition(0, 0).y).toBe(CARD_SLOT_HEIGHT);
    expect(gridPosition(1, 0).x).toBeGreaterThan(gridPosition(0, 0).x);
  });

  it('depends only on the slot, so moving one card leaves a gap and no one else moves', () => {
    const slots = ['a', 'b', 'c'];
    const before = slots.map((_, i) => gridPosition(0, i));
    const after = slots.map((id, i) => (id === 'b' ? null : gridPosition(0, i)));
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
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
