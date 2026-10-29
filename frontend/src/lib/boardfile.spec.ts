import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CARDS,
  MAX_IMPORT_COMMENTS_PER_CARD,
  boardFileFromArchive,
  exportBoardFile,
  exportFileStem,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
  type BoardFileSource
} from './boardfile';
import { importBoard, readBoardAnonymous, readBoardAutoSort, readBoardLabel, readCards } from './yboard';
import { readPhase } from './phase';
import { readNames } from './identity';
import type { CardData, ColumnKey } from './types';

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

function parseOk(text: string): BoardFile {
  const res = parseBoardFile(text);
  if (!res.ok) throw new Error(res.error);
  return res.file;
}

function freshDoc() {
  const doc = new Y.Doc();
  const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
  for (const col of ['wentWell', 'toImprove', 'actions'] as const) board.set(col, new Y.Array<Y.Map<unknown>>());
  return {
    doc,
    board,
    meta: doc.getMap<unknown>('meta'),
    names: doc.getMap<string>('names'),
    phase: doc.getMap<unknown>('phase')
  };
}

function readBack(state: ReturnType<typeof freshDoc>): BoardFileSource {
  const cards = {} as Record<ColumnKey, CardData[]>;
  for (const col of ['wentWell', 'toImprove', 'actions'] as const) cards[col] = readCards(state.board, col);
  return {
    label: readBoardLabel(state.meta),
    anonymous: readBoardAnonymous(state.meta),
    phase: readPhase(state.phase),
    autoSort: readBoardAutoSort(state.meta),
    cards,
    namesMap: readNames(state.names)
  };
}

function withoutIds(cards: Record<ColumnKey, CardData[]>) {
  const out: Record<string, unknown[]> = {};
  for (const [col, list] of Object.entries(cards)) {
    out[col] = list.map(({ id: _id, comments, ...rest }) => ({
      ...rest,
      comments: comments.map(({ id: _cid, ...c }) => c)
    }));
  }
  return out;
}

describe('export → parse → import round trip', () => {
  for (const anonymous of [false, true]) {
    it(`restores the board exactly (${anonymous ? 'anonymous' : 'named'})`, () => {
      const original = exportBoardFile(source({ anonymous, autoSort: false }));
      const state = freshDoc();
      importBoard(state, parseOk(serializeBoardFile(original)));
      const restored = exportBoardFile(readBack(state), original.exportedAt);
      expect(restored.board).toEqual(original.board);
      expect(restored.names).toEqual(original.names);
      expect(withoutIds(restored.cards)).toEqual(withoutIds(original.cards));
      if (anonymous) expect(readNames(state.names)).toEqual({});
    });
  }

  it('round-trips an empty board with its label and settings', () => {
    const original = exportBoardFile(
      source({ cards: { wentWell: [], toImprove: [], actions: [] }, phase: 'actions' })
    );
    const state = freshDoc();
    importBoard(state, parseOk(serializeBoardFile(original)));
    expect(exportBoardFile(readBack(state), original.exportedAt)).toEqual(original);
  });

  it('regenerates card and comment IDs on every import', () => {
    const file = parseOk(serializeBoardFile(exportBoardFile(source())));
    const state = freshDoc();
    importBoard(state, file);
    importBoard(state, file);
    const cards = readCards(state.board, 'wentWell');
    expect(cards).toHaveLength(2);
    const ids = cards.flatMap((c) => [c.id, ...c.comments.map((m) => m.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('c1');
    expect(ids).not.toContain('m1');
  });

  it("doesn't overwrite a name already set on the board", () => {
    const state = freshDoc();
    state.names.set('u_alice', 'Alice (here now)');
    importBoard(state, parseOk(serializeBoardFile(exportBoardFile(source()))));
    expect(readNames(state.names).u_alice).toBe('Alice (here now)');
    expect(readNames(state.names).u_bob).toBe('Bob');
  });

  it('fits a max-size import in one WebSocket frame (2 MiB)', () => {
    const comments = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`,
      text: 'c'.repeat(80),
      authorId: 'u_000000000001',
      createdAt: 1_793_238_519_483 + i
    }));
    const cards: CardData[] = Array.from({ length: MAX_IMPORT_CARDS }, (_, i) => ({
      id: `c${i}`,
      text: 'x'.repeat(2000),
      authorId: `u_${String(i % 20).padStart(12, '0')}`,
      votes: Array.from({ length: 10 }, (_, v) => `u_${String(v).padStart(12, '0')}`),
      reactions: { '👍': ['u_000000000001', 'u_000000000002'] },
      comments
    }));
    const file = exportBoardFile(source({ cards: { wentWell: cards, toImprove: [], actions: [] } }));
    // Shrink card text until the file sits just under the import cap.
    let text = serializeBoardFile(file);
    while (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
      for (const c of file.cards.wentWell) c.text = c.text.slice(0, c.text.length - 100);
      text = serializeBoardFile(file);
    }
    const state = freshDoc();
    let update: Uint8Array | null = null;
    state.doc.on('update', (u: Uint8Array) => {
      update = u;
    });
    importBoard(state, parseOk(text));
    expect(update).not.toBeNull();
    expect(update!.length).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('parseBoardFile', () => {
  const valid = () => JSON.parse(serializeBoardFile(exportBoardFile(source())));

  it('rejects invalid JSON, wrong format, bad and newer versions', () => {
    expect(parseBoardFile('{nope')).toEqual({ ok: false, error: "This file isn't valid JSON." });
    expect(parseBoardFile('')).toMatchObject({ ok: false });
    expect(parseBoardFile('[]')).toMatchObject({ ok: false, error: expect.stringContaining("isn't a fast-retro export") });
    expect(parseBoardFile(JSON.stringify({ ...valid(), format: 'other' }))).toMatchObject({ ok: false });
    expect(parseBoardFile(JSON.stringify({ ...valid(), version: '1' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('version')
    });
    expect(parseBoardFile(JSON.stringify({ ...valid(), version: 2 }))).toEqual({
      ok: false,
      error: 'This file was exported by a newer version of fast-retro.'
    });
  });

  it('rejects files over the size and count caps', () => {
    expect(parseBoardFile(' '.repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining('too large') });
    const many = valid();
    many.cards.toImprove = Array.from({ length: MAX_IMPORT_CARDS }, (_, i) => ({ text: `t${i}` }));
    expect(parseBoardFile(JSON.stringify(many))).toMatchObject({ ok: false, error: expect.stringContaining('cards') });
    const chatty = valid();
    chatty.cards.wentWell[0].comments = Array.from({ length: MAX_IMPORT_COMMENTS_PER_CARD + 1 }, () => ({ text: 'c' }));
    expect(parseBoardFile(JSON.stringify(chatty))).toMatchObject({ ok: false, error: expect.stringContaining('comments') });
  });

  it('ignores names in an anonymous file', () => {
    const raw = valid();
    raw.board.anonymous = true;
    const file = parseOk(JSON.stringify(raw));
    expect(file.names).toBeUndefined();
    const state = freshDoc();
    importBoard(state, file);
    expect(readNames(state.names)).toEqual({});
  });

  it('drops names for users not on the board', () => {
    const raw = valid();
    raw.names.u_stranger = 'Stranger';
    expect(parseOk(JSON.stringify(raw)).names).not.toHaveProperty('u_stranger');
  });

  it('normalizes missing and malformed parts with warnings', () => {
    const res = parseBoardFile(
      JSON.stringify({
        format: 'fast-retro',
        version: 1,
        board: { label: '  Padded  ', phase: 'party' },
        cards: {
          wentWell: [
            { text: 'ok', votes: ['u1', 'u1', 7], reactions: { '👍': [], '🔥': ['u2'] }, comments: [{ text: 'hi' }, { nope: 1 }], extra: true },
            { text: 42 }
          ]
        },
        unknownKey: 1
      })
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.file.board).toEqual({ label: 'Padded', anonymous: false, phase: 'brainstorm', autoSort: true });
    expect(res.file.cards.toImprove).toEqual([]);
    const card = res.file.cards.wentWell[0];
    expect(card).not.toHaveProperty('extra');
    expect(card.votes).toEqual(['u1']);
    expect(card.reactions).toEqual({ '🔥': ['u2'] });
    expect(card.comments).toHaveLength(1);
    expect(res.file).not.toHaveProperty('unknownKey');
    expect(res.warnings).toEqual([
      'Unknown phase; the board will start in Brainstorm.',
      'Skipped 1 card with no text.',
      'Skipped 1 comment with no text.'
    ]);
    expect(res.stats).toMatchObject({ cards: 1, comments: 1, votes: 1, reactions: 1 });
  });

  it('keeps tricky text exactly', () => {
    const text = '=cmd|\'/c calc\'!A1, "quoted"\nnew line, 🎉 +1 @here -x';
    const raw = valid();
    raw.cards.wentWell[0].text = text;
    expect(parseOk(JSON.stringify(raw)).cards.wentWell[0].text).toBe(text);
  });
});
