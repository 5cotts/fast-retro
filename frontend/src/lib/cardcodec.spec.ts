import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { cardFromY, cardToY } from './cardcodec';
import type { CardData } from './types';

const card: CardData = {
  id: 'card-1',
  text: 'Ship it',
  authorId: 'u1',
  votes: ['u1', 'u2'],
  reactions: { '🎉': ['u2'] },
  comments: [{ id: 'c1', text: 'Yes', authorId: 'u2', createdAt: 5 }]
};

function roundTrip(c: CardData): CardData | null {
  const arr = new Y.Doc().getArray<Y.Map<unknown>>('a');
  arr.push([cardToY(c)]);
  return cardFromY(arr.get(0));
}

describe('card codec', () => {
  it('round-trips every field', () => {
    expect(roundTrip(card)).toEqual(card);
  });

  it('round-trips an empty card', () => {
    const empty = { ...card, votes: [], reactions: {}, comments: [] };
    expect(roundTrip(empty)).toEqual(empty);
  });

  it('round-trips a canvas position', () => {
    const moved = { ...card, pos: { x: 12.5, y: -40, z: 3 } };
    expect(roundTrip(moved)).toEqual(moved);
  });

  it('reads a bad position as unmoved', () => {
    const arr = new Y.Doc().getArray<Y.Map<unknown>>('a');
    arr.push([cardToY(card)]);
    arr.get(0).set('pos', { x: 'left', y: 3, z: 1 });
    expect(cardFromY(arr.get(0))).not.toHaveProperty('pos');
  });

  it('skips cards without an id or text, and comments missing fields', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<Y.Map<unknown>>('a');
    const bad = new Y.Map<unknown>();
    bad.set('id', 'x');
    const partial = cardToY(card);
    arr.push([bad, partial]);
    const comment = new Y.Map<unknown>();
    comment.set('id', 'c2');
    (arr.get(1).get('comments') as Y.Array<Y.Map<unknown>>).push([comment]);
    expect(cardFromY(arr.get(0))).toBeNull();
    expect(cardFromY(arr.get(1))?.comments).toEqual(card.comments);
  });
});
