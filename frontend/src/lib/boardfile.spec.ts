import { describe, expect, it } from 'vitest';
import {
  boardFileFromArchive,
  exportBoardFile,
  exportFileStem,
  serializeBoardFile,
  type BoardFileSource
} from './boardfile';
import type { CardData } from './types';

function card(partial: Partial<CardData> & { id: string; text: string }): CardData {
  return { authorId: '', votes: [], reactions: {}, comments: [], ...partial };
}

function source(overrides: Partial<BoardFileSource> = {}): BoardFileSource {
  return {
    label: 'Sprint 42',
    anonymous: false,
    phase: 'discuss',
    autoSort: true,
    cards: {
      wentWell: [
        card({
          id: 'c1',
          text: 'Shipped, "finally"\nwith emoji 🎉',
          authorId: 'u_alice',
          votes: ['u_alice', 'u_bob'],
          reactions: { '👍': ['u_bob'], '🔥': [] },
          comments: [{ id: 'm1', text: '=SUM(A1)', authorId: 'u_carol', createdAt: 5 }]
        })
      ],
      toImprove: [card({ id: 'c2', text: 'Flaky CI', authorId: 'u_bob' })],
      actions: []
    },
    namesMap: { u_alice: 'Alice', u_bob: 'Bob', u_carol: 'Carol', u_lurker: 'Lurker' },
    ...overrides
  };
}

describe('exportBoardFile', () => {
  it('writes the header, board settings and cards', () => {
    const file = exportBoardFile(source(), 123);
    expect(file.format).toBe('fast-retro');
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe(123);
    expect(file.board).toEqual({ label: 'Sprint 42', anonymous: false, phase: 'discuss', autoSort: true });
    expect(file.cards.wentWell[0].text).toBe('Shipped, "finally"\nwith emoji 🎉');
    expect(file.cards.wentWell[0].votes).toEqual(['u_alice', 'u_bob']);
    expect(file.cards.wentWell[0].comments[0].text).toBe('=SUM(A1)');
    expect(file.cards.toImprove.map((c) => c.id)).toEqual(['c2']);
  });

  it('drops empty reaction buckets', () => {
    const file = exportBoardFile(source());
    expect(file.cards.wentWell[0].reactions).toEqual({ '👍': ['u_bob'] });
  });

  it('only includes names for users referenced on the board', () => {
    const file = exportBoardFile(source());
    expect(file.names).toEqual({ u_alice: 'Alice', u_bob: 'Bob', u_carol: 'Carol' });
  });

  it('never includes names for an anonymous board', () => {
    const file = exportBoardFile(source({ anonymous: true }));
    expect(file.names).toBeUndefined();
    const text = serializeBoardFile(file);
    for (const name of ['Alice', 'Bob', 'Carol', 'Lurker']) expect(text).not.toContain(name);
    // Author IDs stay so ownership and vote toggling still work after import.
    expect(file.cards.wentWell[0].authorId).toBe('u_alice');
  });

  it('copies cards rather than aliasing live state', () => {
    const src = source();
    const file = exportBoardFile(src);
    src.cards.wentWell[0].votes.push('u_late');
    expect(file.cards.wentWell[0].votes).toEqual(['u_alice', 'u_bob']);
  });

  it('round-trips through JSON text unchanged', () => {
    const file = exportBoardFile(source());
    expect(JSON.parse(serializeBoardFile(file))).toEqual(file);
  });
});

describe('boardFileFromArchive', () => {
  const base = {
    label: 'Old retro',
    endedAt: 1,
    cards: { wentWell: [card({ id: 'c1', text: 'hi', authorId: 'u_alice' })] },
    names: { u_alice: 'Alice' }
  };

  it('treats archives without an anonymous flag as anonymous', () => {
    const file = boardFileFromArchive(base);
    expect(file.board.anonymous).toBe(true);
    expect(file.names).toBeUndefined();
    expect(file.board.phase).toBe('brainstorm');
    expect(file.board.autoSort).toBe(true);
    expect(file.cards.toImprove).toEqual([]);
  });

  it('uses the recorded flags when present', () => {
    const file = boardFileFromArchive({ ...base, anonymous: false, phase: 'actions', autoSort: false });
    expect(file.board).toEqual({ label: 'Old retro', anonymous: false, phase: 'actions', autoSort: false });
    expect(file.names).toEqual({ u_alice: 'Alice' });
  });
});

describe('exportFileStem', () => {
  const at = new Date('2026-10-29T14:05:09Z');

  it('slugifies the label', () => {
    expect(exportFileStem('Sprint 42 — Mobile', at)).toBe('sprint-42-mobile-2026-10-29-14-05-09');
  });

  it('falls back to "retro" when there is no usable label', () => {
    expect(exportFileStem('', at)).toBe('retro-2026-10-29-14-05-09');
    expect(exportFileStem('🎉🎉', at)).toBe('retro-2026-10-29-14-05-09');
  });
});
