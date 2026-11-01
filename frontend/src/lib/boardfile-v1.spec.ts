import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import v1Text from './fixtures/board-v1.fastretro.json?raw';
import { BOARD_FILE_VERSION, exportBoardFile, parseBoardFile, serializeBoardFile, type BoardFile } from './boardfile';
import { importBoard, readBoardAnonymous, readBoardAutoSort, readBoardImported, readBoardLabel, readCards } from './yboard';
import { readPhase } from './phase';
import { readNames } from './identity';
import type { CardData, ColumnKey } from './types';

// The frozen v1 file (fixtures/README.md). These tests compare against the
// file on disk, not against today's exporter, so a change that alters export
// and import together still fails here if old files would stop importing.

function parseV1(): BoardFile {
  const r = parseBoardFile(v1Text);
  if (!r.ok) throw new Error(r.error);
  expect(r.warnings).toEqual([]);
  return r.file;
}

function freshDoc() {
  const doc = new Y.Doc();
  const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
  for (const col of ['wentWell', 'toImprove', 'actions'] as const) board.set(col, new Y.Array<Y.Map<unknown>>());
  return { doc, board, meta: doc.getMap<unknown>('meta'), names: doc.getMap<string>('names'), phase: doc.getMap<unknown>('phase') };
}

describe('frozen v1 board file', () => {
  it('is still a version this build can read', () => {
    expect(BOARD_FILE_VERSION).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(v1Text).version).toBe(1);
  });

  it('parses with every field intact', () => {
    const file = parseV1();
    expect(file.board).toEqual({ label: 'Sprint 42 — Café 🚀', anonymous: false, phase: 'discuss', autoSort: false });
    expect(file.names).toEqual({ u_alice: 'Alice', u_bob: 'Bob', u_carol: 'Carol' });
    expect(file.cards.wentWell.map((c) => c.text)).toEqual(['Shipped import 🎉', 'Line one\nline two']);
    expect(file.cards.wentWell[0].votes).toEqual(['u_bob', 'u_carol']);
    expect(file.cards.wentWell[0].reactions).toEqual({ '🎉': ['u_bob'], '👍': ['u_alice', 'u_carol'] });
    expect(file.cards.wentWell[0].comments[0].text).toBe('Nice work, "quotes" and, commas');
    expect(file.cards.toImprove[0].text).toBe('=SUM(A1) should stay text');
    expect(file.cards.toImprove[0].comments.map((c) => c.authorId)).toEqual(['u_alice', 'u_bob']);
    expect(file.cards.actions[0].reactions).toEqual({ '✅': ['u_carol'] });
  });

  it('re-exports byte-for-byte', () => {
    expect(serializeBoardFile(parseV1())).toBe(v1Text);
  });

  it('imports into a board that exports back to the same file, apart from new IDs', () => {
    const file = parseV1();
    const state = freshDoc();
    importBoard(state, file, { kind: 'file' }, 1);
    const cards = {} as Record<ColumnKey, CardData[]>;
    for (const col of ['wentWell', 'toImprove', 'actions'] as const) cards[col] = readCards(state.board, col);
    const again = exportBoardFile(
      {
        label: readBoardLabel(state.meta),
        anonymous: readBoardAnonymous(state.meta),
        phase: readPhase(state.phase),
        autoSort: readBoardAutoSort(state.meta),
        cards,
        namesMap: readNames(state.names)
      },
      file.exportedAt
    );
    const stripIds = (f: BoardFile) =>
      JSON.parse(
        JSON.stringify(f, (k, v) => (k === 'id' ? undefined : v))
      );
    expect(stripIds(again)).toEqual(stripIds(file));
    expect(readBoardImported(state.meta)).toEqual({ origin: { kind: 'file' }, at: 1 });
  });
});
