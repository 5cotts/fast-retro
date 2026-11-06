import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import v4Text from './fixtures/board-v4.fastretro.json?raw';
import {
  BOARD_FILE_VERSION,
  boardFileFromArchive,
  exportBoardFile,
  newBoardSeed,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile
} from './boardfile';
import { readLayout, WORLD_LIMIT } from './canvas';
import { readColumns } from './columns';
import { readNames } from './identity';
import { readPhase } from './phase';
import { readAllCards, readBoardAnonymous, readBoardAutoSort, readBoardLabel, setUpAfterSync } from './yboard';

// The frozen v4 file (fixtures/README.md): a canvas board with moved and
// unmoved cards. Compared against the file on disk, not today's exporter.

function parseV4(): BoardFile {
  const r = parseBoardFile(v4Text);
  if (!r.ok) throw new Error(r.error);
  expect(r.warnings).toEqual([]);
  return r.file;
}

function freshState() {
  const doc = new Y.Doc();
  return {
    doc,
    board: doc.getMap<Y.Array<Y.Map<unknown>>>('board'),
    meta: doc.getMap<unknown>('meta'),
    names: doc.getMap<string>('names'),
    phase: doc.getMap<unknown>('phase')
  };
}

function exportState(state: ReturnType<typeof freshState>, at: number): BoardFile {
  return exportBoardFile(
    {
      label: readBoardLabel(state.meta),
      anonymous: readBoardAnonymous(state.meta),
      phase: readPhase(state.phase),
      autoSort: readBoardAutoSort(state.meta),
      columns: readColumns(state.meta),
      layout: readLayout(state.meta),
      cards: readAllCards(state.board),
      namesMap: readNames(state.names)
    },
    at
  );
}

const positions = (file: BoardFile) =>
  Object.fromEntries(Object.entries(file.cards).map(([key, list]) => [key, list.map((c) => [c.text, c.pos ?? null])]));

describe('frozen v4 board file', () => {
  it('is still a version this build can read', () => {
    expect(BOARD_FILE_VERSION).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(v4Text).version).toBe(4);
  });

  it('parses with its layout and positions intact', () => {
    const file = parseV4();
    expect(file.board.layout).toBe('canvas');
    expect(file.cards['c-ok'][0].pos).toEqual({ x: 640, y: 120.5, z: 2 });
    expect(file.cards['c-ok'][1]).not.toHaveProperty('pos');
  });

  it('re-exports byte-for-byte', () => {
    expect(serializeBoardFile(parseV4())).toBe(v4Text);
  });

  it('imports and exports back to the same layout, positions and everything else', () => {
    const file = parseV4();
    const state = freshState();
    setUpAfterSync(state, { file, origin: { kind: 'file' } });
    expect(readLayout(state.meta)).toBe('canvas');
    const again = exportState(state, file.exportedAt);
    expect(again.version).toBe(4);
    expect(positions(again)).toEqual(positions(file));
    expect(again.board).toEqual(file.board);
    expect(again.names).toEqual(file.names);
    const withoutIds = (f: BoardFile) =>
      Object.values(f.cards)
        .flat()
        .map(({ id: _id, comments, ...rest }) => ({ ...rest, comments: comments.map(({ id: _cid, ...c }) => c) }));
    expect(withoutIds(again)).toEqual(withoutIds(file));
  });
});

describe('canvas export', () => {
  const card = (id: string, pos?: { x: number; y: number; z: number }) => ({
    id,
    text: id,
    authorId: '',
    votes: [],
    reactions: {},
    comments: [],
    ...(pos ? { pos } : {})
  });
  const base = { label: 'B', anonymous: true, phase: 'group' as const, autoSort: true, namesMap: {} };

  it('writes v4 only for a canvas, even with no cards', () => {
    expect(exportBoardFile({ ...base, layout: 'canvas', cards: {} }).version).toBe(4);
    expect(newBoardSeed({ label: 'B', anonymous: true, layout: 'canvas' }).version).toBe(4);
    expect(newBoardSeed({ label: 'B', anonymous: true, layout: 'canvas' }).board.layout).toBe('canvas');
  });

  it('leaves column boards as they were, with no layout key', () => {
    const file = exportBoardFile({ ...base, cards: { wentWell: [card('a')] } });
    expect(file.version).toBe(1);
    expect(file.board).not.toHaveProperty('layout');
    expect(newBoardSeed({ label: 'B', anonymous: true }).version).toBe(1);
  });

  it('drops positions from a column board', () => {
    const file = exportBoardFile({ ...base, cards: { wentWell: [card('a', { x: 1, y: 2, z: 3 })] } });
    expect(file.cards.wentWell[0]).not.toHaveProperty('pos');
  });

  it('copies positions, so the file does not share objects with the doc read', () => {
    const pos = { x: 1, y: 2, z: 3 };
    const file = exportBoardFile({ ...base, layout: 'canvas', cards: { wentWell: [card('a', pos)] } });
    expect(file.cards.wentWell[0].pos).toEqual(pos);
    expect(file.cards.wentWell[0].pos).not.toBe(pos);
  });

  it('keeps layout and positions through an archive, and tolerates archives without them', () => {
    const archive = { label: 'A', endedAt: 1, layout: 'canvas', cards: { wentWell: [card('a', { x: 4, y: 5, z: 6 })] } };
    const file = boardFileFromArchive(archive);
    expect(file.version).toBe(4);
    expect(file.board.layout).toBe('canvas');
    expect(file.cards.wentWell[0].pos).toEqual({ x: 4, y: 5, z: 6 });
    const { layout: _, ...old } = archive;
    const oldFile = boardFileFromArchive(old);
    expect(oldFile.version).toBe(1);
    expect(oldFile.cards.wentWell[0]).not.toHaveProperty('pos');
    expect(boardFileFromArchive({ ...archive, layout: 42 }).board).not.toHaveProperty('layout');
  });
});

describe('canvas import', () => {
  const file = (board: object, cards: object) =>
    JSON.stringify({ format: 'fast-retro', version: 4, exportedAt: 1, board: { label: 'B', ...board }, cards });
  const parse = (text: string) => {
    const r = parseBoardFile(text);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it('imports a bad position as unmoved, without failing', () => {
    const r = parse(
      file(
        { layout: 'canvas' },
        {
          wentWell: [
            { text: 'a', pos: { x: 'left', y: 1, z: 1 } },
            { text: 'b', pos: 'nope' },
            { text: 'c', pos: { x: NaN, y: 1, z: 1 } },
            { text: 'd', pos: { x: 3, y: 4, z: 5 } }
          ]
        }
      )
    );
    expect(r.file.cards.wentWell.map((c) => c.pos ?? null)).toEqual([null, null, null, { x: 3, y: 4, z: 5 }]);
  });

  it('clamps an out-of-bounds position', () => {
    const r = parse(file({ layout: 'canvas' }, { wentWell: [{ text: 'a', pos: { x: 9e9, y: -9e9, z: 1 } }] }));
    expect(r.file.cards.wentWell[0].pos).toEqual({ x: WORLD_LIMIT, y: -WORLD_LIMIT, z: 1 });
  });

  it('ignores positions in a file that is not a canvas', () => {
    const r = parse(file({}, { wentWell: [{ text: 'a', pos: { x: 3, y: 4, z: 5 } }] }));
    expect(r.file.cards.wentWell[0]).not.toHaveProperty('pos');
    expect(r.file.version).toBe(1);
  });

  it('warns about an unknown layout and uses columns', () => {
    const r = parse(file({ layout: 'spiral' }, { wentWell: [{ text: 'a', pos: { x: 3, y: 4, z: 5 } }] }));
    expect(r.file.board).not.toHaveProperty('layout');
    expect(r.file.cards.wentWell[0]).not.toHaveProperty('pos');
    expect(r.warnings).toEqual(['Unknown layout; the board will use columns.']);
  });

  it('seeds a canvas layout only from a canvas file', () => {
    const canvas = freshState();
    setUpAfterSync(canvas, { file: newBoardSeed({ label: 'B', anonymous: true, layout: 'canvas' }), origin: { kind: 'new' } });
    expect(canvas.meta.get('layout')).toBe('canvas');
    const columns = freshState();
    setUpAfterSync(columns, { file: newBoardSeed({ label: 'B', anonymous: true }), origin: { kind: 'new' } });
    expect(columns.meta.has('layout')).toBe(false);
  });

  it('importing twice keeps positions but makes independent cards', () => {
    const parsed = parseV4();
    const a = freshState();
    const b = freshState();
    setUpAfterSync(a, { file: parsed, origin: { kind: 'file' } });
    setUpAfterSync(b, { file: parsed, origin: { kind: 'file' } });
    const ids = (s: typeof a) => Object.values(readAllCards(s.board)).flat().map((c) => c.id);
    expect(ids(a).some((id) => ids(b).includes(id))).toBe(false);
    expect(readAllCards(a.board)['c-ok'][0].pos).toEqual(parsed.cards['c-ok'][0].pos);
  });
});
