import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import v3Text from './fixtures/board-v3.fastretro.json?raw';
import {
  BOARD_FILE_VERSION,
  boardFileFromArchive,
  describeStats,
  exportBoardFile,
  newBoardSeed,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile
} from './boardfile';
import { clusterMapOf, layoutBoard, readClusters } from './clusters';
import { DEFAULT_COLUMNS, readColumns } from './columns';
import { readNames } from './identity';
import { readPhase } from './phase';
import { readAllCards, readBoardAnonymous, readBoardAutoSort, readBoardLabel, readCards, setUpAfterSync } from './yboard';

// The frozen v3 file (fixtures/README.md): a classic board with groups.
// Compared against the file on disk, not against today's exporter.

function parseV3(): BoardFile {
  const r = parseBoardFile(v3Text);
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
      clusters: readClusters(clusterMapOf(state.doc)),
      cards: readAllCards(state.board),
      namesMap: readNames(state.names)
    },
    at
  );
}

// Group IDs are regenerated on import, so compare groups by name.
function groupShape(file: BoardFile) {
  const labelOf = new Map((file.board.clusters ?? []).map((c) => [c.id, c.label]));
  return Object.fromEntries(
    Object.entries(file.cards).map(([key, list]) => [key, list.map((c) => [c.text, c.clusterId ? labelOf.get(c.clusterId) : null])])
  );
}

describe('frozen v3 board file', () => {
  it('is still a version this build can read', () => {
    expect(BOARD_FILE_VERSION).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(v3Text).version).toBe(3);
  });

  it('parses with its groups intact', () => {
    const file = parseV3();
    expect(file.board.clusters).toEqual([
      { id: 'g-deploys', label: 'Deploys' },
      { id: 'g-untitled', label: '' },
      { id: 'g-onecard', label: 'Named with one card' }
    ]);
    expect(file.cards.wentWell[0].clusterId).toBe('g-deploys');
    expect(file.cards.toImprove[0].clusterId).toBe('g-deploys');
    expect(file.cards.wentWell[2]).not.toHaveProperty('clusterId');
    expect(file.cards.actions[0]).not.toHaveProperty('clusterId');
  });

  it('re-exports byte-for-byte', () => {
    expect(serializeBoardFile(parseV3())).toBe(v3Text);
  });

  it('imports with new group IDs and exports back to the same groups', () => {
    const file = parseV3();
    const state = freshState();
    setUpAfterSync(state, { file, origin: { kind: 'file' } });
    const clusters = readClusters(clusterMapOf(state.doc));
    expect(clusters.map((c) => c.id)).not.toContain('g-deploys');
    const again = exportState(state, file.exportedAt);
    expect(again.version).toBe(3);
    expect(again.board.clusters!.map((c) => c.label)).toEqual(['Deploys', '', 'Named with one card']);
    expect(groupShape(again)).toEqual(groupShape(file));
  });

  it('lays out as lanes after import, in the file order', () => {
    const state = freshState();
    setUpAfterSync(state, { file: parseV3(), origin: { kind: 'file' } });
    const { lanes } = layoutBoard(DEFAULT_COLUMNS, readAllCards(state.board), readClusters(clusterMapOf(state.doc)), {
      showClusters: true,
      sortByVotes: false
    });
    expect(lanes.map((l) => [l.cluster.label, l.count])).toEqual([
      ['Deploys', 2],
      ['', 2],
      ['Named with one card', 1]
    ]);
  });

  it('importing twice makes independent groups', () => {
    const file = parseV3();
    const a = freshState();
    const b = freshState();
    setUpAfterSync(a, { file, origin: { kind: 'file' } });
    setUpAfterSync(b, { file, origin: { kind: 'file' } });
    const idsOf = (s: typeof a) => new Set(readClusters(clusterMapOf(s.doc)).map((c) => c.id));
    expect([...idsOf(a)].some((id) => idsOf(b).has(id))).toBe(false);
  });
});

describe('group export', () => {
  const card = (id: string, clusterId?: string) => ({
    id,
    text: id,
    authorId: '',
    votes: [],
    reactions: {},
    comments: [],
    ...(clusterId ? { clusterId } : {})
  });
  const base = { label: 'B', anonymous: true, phase: 'group' as const, autoSort: true, namesMap: {} };
  const cluster = (id: string, createdAt: number, label = id) => ({ id, label, createdAt });

  it('stays v1 or v2 when there are no groups, so older builds can still read it', () => {
    expect(exportBoardFile({ ...base, cards: { wentWell: [card('a')] } }).version).toBe(1);
    expect(exportBoardFile({ ...base, clusters: [cluster('empty', 1)], cards: { wentWell: [card('a')] } }).version).toBe(1);
    const seed = newBoardSeed({ label: 'B', anonymous: true });
    expect(seed.version).toBe(1);
    expect(seed.board).not.toHaveProperty('clusters');
  });

  it('writes only groups with cards, oldest first', () => {
    const file = exportBoardFile({
      ...base,
      clusters: [cluster('new', 3), cluster('empty', 2), cluster('old', 1)],
      cards: { wentWell: [card('a', 'new')], toImprove: [card('b', 'old')] }
    });
    expect(file.version).toBe(3);
    expect(file.board.clusters!.map((c) => c.id)).toEqual(['old', 'new']);
  });

  it('drops a pointer to an unknown group and any group on an action item', () => {
    const file = exportBoardFile({
      ...base,
      clusters: [cluster('g', 1)],
      cards: { wentWell: [card('a', 'gone')], actions: [card('b', 'g')] }
    });
    expect(file.version).toBe(1);
    expect(file.board).not.toHaveProperty('clusters');
    expect(file.cards.wentWell[0]).not.toHaveProperty('clusterId');
    expect(file.cards.actions[0]).not.toHaveProperty('clusterId');
  });

  it('keeps groups through an archive, and tolerates archives without them', () => {
    const archive = {
      label: 'A',
      endedAt: 1,
      cards: { wentWell: [card('a', 'g')], toImprove: [card('b', 'g')] },
      clusters: [{ id: 'g', label: 'Deploys' }]
    };
    const file = boardFileFromArchive(archive);
    expect(file.version).toBe(3);
    expect(file.board.clusters).toEqual([{ id: 'g', label: 'Deploys' }]);
    expect(file.cards.toImprove[0].clusterId).toBe('g');
    const { clusters: _, ...old } = archive;
    const oldFile = boardFileFromArchive(old);
    expect(oldFile.version).toBe(1);
    expect(oldFile.cards.wentWell[0]).not.toHaveProperty('clusterId');
  });

  it('carries no names on an anonymous board with groups', () => {
    const file = exportBoardFile({
      ...base,
      namesMap: { u: 'Alice' },
      clusters: [cluster('g', 1)],
      cards: { wentWell: [{ ...card('a', 'g'), authorId: 'u' }] }
    });
    expect(file).not.toHaveProperty('names');
    expect(JSON.stringify(file)).not.toContain('Alice');
  });
});

describe('group import', () => {
  const file = (board: object, cards: object) =>
    JSON.stringify({ format: 'fast-retro', version: 3, exportedAt: 1, board: { label: 'B', ...board }, cards });
  const parse = (text: string) => {
    const r = parseBoardFile(text);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it('ungroups a card pointing at a group the file does not define, with a warning', () => {
    const r = parse(file({ clusters: [] }, { wentWell: [{ text: 'a', clusterId: 'nope' }, { text: 'b', clusterId: 'nope' }] }));
    expect(r.file.cards.wentWell[0]).not.toHaveProperty('clusterId');
    expect(r.warnings).toEqual(["2 cards referred to a group this file doesn't define, and will be ungrouped."]);
    expect(r.file.version).toBe(1);
  });

  it('caps long names and skips malformed or repeated groups', () => {
    const r = parse(
      file(
        {
          clusters: [
            { id: 'g', label: `  ${'x'.repeat(200)}` },
            { id: 'g', label: 'Repeat' },
            { id: 'n', label: 42 },
            { label: 'No ID' },
            'nope',
            { id: 'y'.repeat(65), label: 'Long ID' }
          ]
        },
        { wentWell: [{ text: 'a', clusterId: 'g' }, { text: 'b', clusterId: 'n' }] }
      )
    );
    expect(r.file.board.clusters).toEqual([
      { id: 'g', label: 'x'.repeat(60) },
      { id: 'n', label: '' }
    ]);
  });

  it('ignores clusters that are not a list', () => {
    const r = parse(file({ clusters: 'nope' }, { wentWell: [{ text: 'a' }] }));
    expect(r.file.board).not.toHaveProperty('clusters');
  });

  it('never groups an action item', () => {
    const r = parse(file({ clusters: [{ id: 'g', label: 'G' }] }, { actions: [{ text: 'a', clusterId: 'g' }] }));
    expect(r.file.cards.actions[0]).not.toHaveProperty('clusterId');
    expect(r.file.board).not.toHaveProperty('clusters');
    expect(r.warnings).toEqual([]);
  });

  it('counts groups in the import summary', () => {
    const r = parse(file({ anonymous: true, clusters: [{ id: 'g', label: 'G' }] }, { wentWell: [{ text: 'a', clusterId: 'g' }] }));
    expect(r.stats.groups).toBe(1);
    expect(describeStats(r.stats, true)).toContain('1 group');
    const none = parse(file({ anonymous: true }, { wentWell: [{ text: 'a' }] }));
    expect(describeStats(none.stats, true)).not.toContain('group');
  });

  it('seeds no group map entries from a board with none', () => {
    const state = freshState();
    setUpAfterSync(state, { file: newBoardSeed({ label: 'B', anonymous: true }), origin: { kind: 'new' } });
    expect(clusterMapOf(state.doc).size).toBe(0);
    expect(readCards(state.board, 'wentWell')).toEqual([]);
  });
});
