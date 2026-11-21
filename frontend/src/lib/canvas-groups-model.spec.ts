import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WORLD_LIMIT } from './canvas';
import { clusterMapOf, readClusters, type ClusterMap } from './clusters';
import {
  boardFileFromArchive,
  clustersInUse,
  exportBoardFile,
  parseBoardFile,
  sanitizeFileClusters,
  serializeBoardFile,
  type BoardFile
} from './boardfile';
import { readAllCards, createCluster, renameCluster, setCardCluster, setClusterPos, setUpAfterSync } from './yboard';
import { DEFAULT_COLUMNS } from './columns';
import type { CardData } from './types';

function freshDoc() {
  const doc = new Y.Doc();
  return {
    doc,
    board: doc.getMap<Y.Array<Y.Map<unknown>>>('board'),
    meta: doc.getMap<unknown>('meta'),
    names: doc.getMap<string>('names'),
    phase: doc.getMap<unknown>('phase'),
    clusters: clusterMapOf(doc) as ClusterMap
  };
}

const card = (id: string, over: Partial<CardData> = {}): CardData => ({
  id,
  text: id,
  authorId: '',
  votes: [],
  reactions: {},
  comments: [],
  ...over
});

const base = { label: 'B', anonymous: true, phase: 'group' as const, autoSort: true, namesMap: {} };
const placed = { id: 'g1', label: 'Deploys', createdAt: 1, pos: { x: -40.5, y: 12, z: 3 } };
const grouped = { wentWell: [card('a', { clusterId: 'g1' }), card('b', { clusterId: 'g1' })] };

describe('a group on a canvas: stored position', () => {
  it('is read back with its z, and absent for a group that was never placed', () => {
    const { clusters } = freshDoc();
    const withPos = createCluster(clusters, 'Placed', 1, { x: 10, y: -20, z: 5 });
    const without = createCluster(clusters, 'Plain', 2);
    const byId = new Map(readClusters(clusters).map((c) => [c.id, c]));
    expect(byId.get(withPos)?.pos).toEqual({ x: 10, y: -20, z: 5 });
    expect(byId.get(without)).not.toHaveProperty('pos');
  });

  it('clamps a position that is out of bounds, and ignores one that is not a number', () => {
    const { clusters } = freshDoc();
    clusters.set('far', { label: 'far', createdAt: 1, x: 999_999, y: -999_999, z: -4 });
    clusters.set('bad', { label: 'bad', createdAt: 2, x: 'left' as unknown as number, y: 0 });
    clusters.set('nan', { label: 'nan', createdAt: 3, x: Number.NaN, y: 0 });
    clusters.set('half', { label: 'half', createdAt: 4, x: 5 });
    const byId = new Map(readClusters(clusters).map((c) => [c.id, c]));
    expect(byId.get('far')?.pos).toEqual({ x: WORLD_LIMIT, y: -WORLD_LIMIT, z: 0 });
    for (const id of ['bad', 'nan', 'half']) expect(byId.get(id)).not.toHaveProperty('pos');
  });

  it('moves a group, and keeps its name and creation time', () => {
    const { clusters } = freshDoc();
    const id = createCluster(clusters, 'Name', 7, { x: 1, y: 2, z: 1 });
    setClusterPos(clusters, id, { x: 30, y: 40, z: 9 });
    expect(readClusters(clusters)[0]).toEqual({ id, label: 'Name', createdAt: 7, pos: { x: 30, y: 40, z: 9 } });
  });

  it('survives a rename, and a move survives a rename', () => {
    const { clusters } = freshDoc();
    const id = createCluster(clusters, 'Old', 1, { x: 1, y: 2, z: 1 });
    renameCluster(clusters, id, 'New');
    expect(readClusters(clusters)[0]).toMatchObject({ label: 'New', pos: { x: 1, y: 2, z: 1 } });
    setClusterPos(clusters, id, { x: 5, y: 6, z: 2 });
    expect(readClusters(clusters)[0]).toMatchObject({ label: 'New', pos: { x: 5, y: 6, z: 2 } });
  });

  it('ignores a move for a group that does not exist or a position that is not valid', () => {
    const { clusters } = freshDoc();
    setClusterPos(clusters, 'missing', { x: 1, y: 2, z: 1 });
    expect(clusters.size).toBe(0);
    const id = createCluster(clusters, 'G', 1, { x: 1, y: 2, z: 1 });
    setClusterPos(clusters, id, { x: Number.NaN, y: 0, z: 0 });
    expect(readClusters(clusters)[0].pos).toEqual({ x: 1, y: 2, z: 1 });
  });

  it('merges as one record when two people write at once (last writer wins as a whole)', () => {
    const a = freshDoc();
    const id = createCluster(a.clusters, 'G', 1, { x: 0, y: 0, z: 1 });
    const b = freshDoc();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    renameCluster(a.clusters, id, 'Renamed');
    setClusterPos(b.clusters, id, { x: 50, y: 60, z: 2 });
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const left = readClusters(a.clusters)[0];
    expect(left).toEqual(readClusters(b.clusters)[0]);
    expect(left.label === 'Renamed' || left.pos?.x === 50).toBe(true);
  });
});

describe('a group on a canvas: board file', () => {
  it('writes a placed group only for a canvas, and copies it', () => {
    const canvas = exportBoardFile({ ...base, layout: 'canvas', clusters: [placed], cards: grouped });
    expect(canvas.version).toBe(4);
    expect(canvas.board.clusters).toEqual([{ id: 'g1', label: 'Deploys', pos: placed.pos }]);
    expect(canvas.board.clusters?.[0].pos).not.toBe(placed.pos);

    const columns = exportBoardFile({ ...base, clusters: [placed], cards: grouped });
    expect(columns.version).toBe(3);
    expect(columns.board.clusters).toEqual([{ id: 'g1', label: 'Deploys' }]);
  });

  it('writes a group that was never placed exactly as before', () => {
    const file = exportBoardFile({
      ...base,
      layout: 'canvas',
      clusters: [{ id: 'g1', label: 'Deploys', createdAt: 1 }],
      cards: grouped
    });
    expect(file.board.clusters).toEqual([{ id: 'g1', label: 'Deploys' }]);
  });

  it('round-trips through parse', () => {
    const file = exportBoardFile({ ...base, layout: 'canvas', clusters: [placed], cards: grouped });
    const parsed = parseBoardFile(serializeBoardFile(file));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.file.board.clusters).toEqual(file.board.clusters);
  });

  it('clamps a hand-edited position, drops one that is not valid, and ignores it on a column file', () => {
    const file = exportBoardFile({ ...base, layout: 'canvas', clusters: [placed], cards: grouped });
    const edit = (pos: unknown, layout = true): BoardFile => {
      const copy = JSON.parse(serializeBoardFile(file));
      copy.board.clusters[0].pos = pos;
      if (!layout) delete copy.board.layout;
      const parsed = parseBoardFile(JSON.stringify(copy));
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.file;
    };
    expect(edit({ x: 1e9, y: -1e9 }).board.clusters?.[0].pos).toEqual({ x: WORLD_LIMIT, y: -WORLD_LIMIT, z: 0 });
    expect(edit({ x: 'a', y: 2 }).board.clusters?.[0]).not.toHaveProperty('pos');
    expect(edit('left').board.clusters?.[0]).not.toHaveProperty('pos');
    expect(edit({ x: 1, y: 2, z: 3 }, false).board.clusters?.[0]).not.toHaveProperty('pos');
  });

  it('keeps a placed group through an archive, and tolerates archives without positions', () => {
    const archive = { label: 'A', endedAt: 1, layout: 'canvas', cards: grouped, clusters: [{ id: 'g1', label: 'Deploys', pos: placed.pos }] };
    expect(boardFileFromArchive(archive).board.clusters).toEqual([{ id: 'g1', label: 'Deploys', pos: placed.pos }]);
    const old = { ...archive, clusters: [{ id: 'g1', label: 'Deploys' }] };
    expect(boardFileFromArchive(old).board.clusters).toEqual([{ id: 'g1', label: 'Deploys' }]);
    const asColumns = { ...archive, layout: undefined };
    expect(boardFileFromArchive(asColumns).board.clusters).toEqual([{ id: 'g1', label: 'Deploys' }]);
  });

  it('sanitizeFileClusters keeps a valid position and nothing else it was not given', () => {
    expect(sanitizeFileClusters([{ id: 'g', label: 'x', pos: { x: 1, y: 2 }, extra: true }])).toEqual([
      { id: 'g', label: 'x', pos: { x: 1, y: 2, z: 0 } }
    ]);
  });

  it('clustersInUse drops the position for a column board and keeps it for a canvas', () => {
    expect(clustersInUse([placed], grouped, DEFAULT_COLUMNS)[0]).not.toHaveProperty('pos');
    expect(clustersInUse([placed], grouped, DEFAULT_COLUMNS, 'canvas')[0].pos).toEqual(placed.pos);
  });
});

describe('a group on a canvas: import', () => {
  function importFile(file: BoardFile) {
    const state = freshDoc();
    setUpAfterSync(state, { file, origin: { kind: 'file' } });
    return state;
  }

  it('seeds the group with its position and its cards in it', () => {
    const file = exportBoardFile({ ...base, layout: 'canvas', clusters: [placed], cards: grouped });
    const state = importFile(file);
    const [group] = readClusters(state.clusters);
    expect(group.pos).toEqual(placed.pos);
    const members = Object.values(readAllCards(state.board)).flat().filter((c) => c.clusterId === group.id);
    expect(members).toHaveLength(2);
  });

  it('importing the same file twice gives each board its own group with the same position', () => {
    const file = exportBoardFile({ ...base, layout: 'canvas', clusters: [placed], cards: grouped });
    const a = importFile(file);
    const b = importFile(file);
    expect(readClusters(a.clusters)[0].id).not.toBe(readClusters(b.clusters)[0].id);
    expect(readClusters(b.clusters)[0].pos).toEqual(placed.pos);
  });

  it('moving a card to another imported group works as on any board', () => {
    const state = importFile(exportBoardFile({ ...base, layout: 'canvas', clusters: [placed], cards: grouped }));
    const [group] = readClusters(state.clusters);
    const id = createCluster(state.clusters, 'Other', 9, { x: 0, y: 0, z: 1 });
    const first = state.board.get('wentWell')!.get(0) as Y.Map<unknown>;
    expect(first.get('clusterId')).toBe(group.id);
    setCardCluster(state.board, 'wentWell', first.get('id') as string, id);
    expect(readAllCards(state.board).wentWell[0].clusterId).toBe(id);
  });
});
