import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { cardFromY, cardToY } from './cardcodec';
import {
  canEditClusters,
  clustersVisible,
  layoutBoard,
  MAX_CLUSTER_LABEL_LEN,
  readClusters,
  reorderTarget,
  sectionOf,
  sortedByVotes,
  type ClusterDef,
  type ClusterMap,
  type ClusterRecord
} from './clusters';
import { ACTIONS_COLUMN_KEY, DEFAULT_COLUMNS, type ColumnDef } from './columns';
import type { CardData } from './types';
import {
  addCard,
  createCluster,
  deleteCard,
  dissolveCluster,
  mergeCards,
  mergeCluster,
  moveCard,
  readCards,
  renameCluster,
  setCardCluster
} from './yboard';

const COLUMNS: ColumnDef[] = [
  { key: 'a', title: 'A', color: 'emerald' },
  { key: 'b', title: 'B', color: 'amber' },
  { key: ACTIONS_COLUMN_KEY, title: 'Action items', color: 'sky' }
];

function card(id: string, over: Partial<CardData> = {}): CardData {
  return { id, text: id, authorId: 'u', votes: [], reactions: {}, comments: [], ...over };
}

const cluster = (id: string, label = '', createdAt = 1): ClusterDef => ({ id, label, createdAt });
const ON = { showClusters: true, sortByVotes: false };
const ids = (cards: CardData[]) => cards.map((c) => c.id);

function emptyDoc() {
  const doc = new Y.Doc();
  return {
    doc,
    board: doc.getMap<Y.Array<Y.Map<unknown>>>('board'),
    clusters: doc.getMap<ClusterRecord>('clusters') as ClusterMap
  };
}

function freshDoc() {
  const doc = new Y.Doc();
  const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
  const clusters: ClusterMap = doc.getMap<ClusterRecord>('clusters');
  doc.transact(() => {
    for (const col of DEFAULT_COLUMNS) board.set(col.key, new Y.Array<Y.Map<unknown>>());
  });
  return { doc, board, clusters };
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('layoutBoard', () => {
  it('puts cards in the same cluster in one lane, each in its own column', () => {
    const { lanes, loose } = layoutBoard(
      COLUMNS,
      { a: [card('1', { clusterId: 'c' }), card('2')], b: [card('3', { clusterId: 'c' })], actions: [] },
      [cluster('c', 'Deploys')],
      ON
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].cluster.label).toBe('Deploys');
    expect(ids(lanes[0].cards.a)).toEqual(['1']);
    expect(ids(lanes[0].cards.b)).toEqual(['3']);
    expect(lanes[0].count).toBe(2);
    expect(ids(loose.a)).toEqual(['2']);
    expect(loose.b).toEqual([]);
  });

  it('shows everything flat when clusters are hidden', () => {
    const { lanes, loose } = layoutBoard(
      COLUMNS,
      { a: [card('1', { clusterId: 'c' })], b: [card('2', { clusterId: 'c' })] },
      [cluster('c', 'Deploys')],
      { showClusters: false, sortByVotes: false }
    );
    expect(lanes).toEqual([]);
    expect(ids(loose.a)).toEqual(['1']);
    expect(ids(loose.b)).toEqual(['2']);
  });

  it('treats a card pointing at an unknown cluster as ungrouped', () => {
    const { lanes, loose } = layoutBoard(COLUMNS, { a: [card('1', { clusterId: 'gone' })] }, [], ON);
    expect(lanes).toEqual([]);
    expect(ids(loose.a)).toEqual(['1']);
  });

  it('does not show a cluster with no cards', () => {
    expect(layoutBoard(COLUMNS, { a: [card('1')] }, [cluster('c', 'Empty')], ON).lanes).toEqual([]);
  });

  it('shows a one-card cluster as a normal card unless it has a name', () => {
    const cards = { a: [card('1', { clusterId: 'c' })] };
    const unnamed = layoutBoard(COLUMNS, cards, [cluster('c')], ON);
    expect(unnamed.lanes).toEqual([]);
    expect(ids(unnamed.loose.a)).toEqual(['1']);
    const named = layoutBoard(COLUMNS, cards, [cluster('c', 'Deploys')], ON);
    expect(named.lanes).toHaveLength(1);
    expect(named.loose.a).toEqual([]);
  });

  it('never puts action items in a lane, whatever the doc says', () => {
    const { lanes, loose } = layoutBoard(
      COLUMNS,
      { a: [card('1', { clusterId: 'c' }), card('2', { clusterId: 'c' })], actions: [card('3', { clusterId: 'c' })] },
      [cluster('c', 'Deploys')],
      ON
    );
    expect(lanes[0].count).toBe(2);
    expect(Object.keys(lanes[0].cards)).toEqual(['a', 'b']);
    expect(ids(loose.actions)).toEqual(['3']);
  });

  it('ignores cards in arrays that are no longer columns', () => {
    const { lanes, loose } = layoutBoard(
      COLUMNS,
      { removed: [card('1', { clusterId: 'c' }), card('2', { clusterId: 'c' })] },
      [cluster('c')],
      ON
    );
    expect(lanes).toEqual([]);
    expect(loose.removed).toBeUndefined();
  });

  it('keeps lanes in creation order when not sorting, whatever the votes', () => {
    const { lanes } = layoutBoard(
      COLUMNS,
      {
        a: [
          card('1', { clusterId: 'newer', votes: ['x', 'y'] }),
          card('2', { clusterId: 'older' })
        ]
      },
      [cluster('newer', 'Newer', 20), cluster('older', 'Older', 10)],
      ON
    );
    expect(lanes.map((l) => l.cluster.id)).toEqual(['older', 'newer']);
  });

  it('counts people, not votes, and sorts lanes and cards when asked', () => {
    const { lanes, loose } = layoutBoard(
      COLUMNS,
      {
        a: [
          card('many1', { clusterId: 'many', votes: ['x'] }),
          card('many2', { clusterId: 'many', votes: ['x'] }),
          card('many3', { clusterId: 'many', votes: ['x', 'y'] }),
          card('few1', { clusterId: 'few', votes: ['x', 'y', 'z'] }),
          card('loose1'),
          card('loose2', { votes: ['x'] })
        ]
      },
      [cluster('many', 'Many', 1), cluster('few', 'Few', 2)],
      { showClusters: true, sortByVotes: true }
    );
    expect(lanes.map((l) => [l.cluster.id, l.voters, l.count])).toEqual([
      ['few', 3, 1],
      ['many', 2, 3]
    ]);
    expect(ids(lanes[1].cards.a)).toEqual(['many3', 'many1', 'many2']);
    expect(ids(loose.a)).toEqual(['loose2', 'loose1']);
  });

  it('breaks lane ties by creation order when sorting', () => {
    const { lanes } = layoutBoard(
      COLUMNS,
      { a: [card('1', { clusterId: 'second' }), card('2', { clusterId: 'first' })] },
      [cluster('second', 'S', 2), cluster('first', 'F', 1)],
      { showClusters: true, sortByVotes: true }
    );
    expect(lanes.map((l) => l.cluster.id)).toEqual(['first', 'second']);
  });

  it('handles the 300-card import limit', () => {
    const a: CardData[] = [];
    const clusters: ClusterDef[] = [];
    for (let i = 0; i < 300; i++) {
      if (i % 3 === 0) clusters.push(cluster(`c${i}`, `Group ${i}`, i));
      a.push(card(`${i}`, { clusterId: `c${i - (i % 3)}`, votes: [`u${i}`] }));
    }
    const { lanes, loose } = layoutBoard(COLUMNS, { a }, clusters, { showClusters: true, sortByVotes: true });
    expect(lanes).toHaveLength(100);
    expect(lanes.every((l) => l.count === 3 && l.voters === 3)).toBe(true);
    expect(loose.a).toEqual([]);
  });
});

describe('sortedByVotes', () => {
  it('sorts by votes, keeps ties in place and leaves the input alone', () => {
    const input = [card('a'), card('b', { votes: ['x'] }), card('c')];
    expect(ids(sortedByVotes(input))).toEqual(['b', 'a', 'c']);
    expect(ids(input)).toEqual(['a', 'b', 'c']);
  });
});

describe('visibility rules', () => {
  it('hides groups in Brainstorm, unless the board has ended', () => {
    expect(clustersVisible('brainstorm', false)).toBe(false);
    expect(clustersVisible('brainstorm', true)).toBe(true);
    expect(clustersVisible('group', false)).toBe(true);
    expect(clustersVisible('discuss', false)).toBe(true);
  });

  it('allows editing only in the Group phase of a live board', () => {
    expect(canEditClusters('group', false)).toBe(true);
    expect(canEditClusters('group', true)).toBe(false);
    expect(canEditClusters('vote', false)).toBe(false);
  });
});

describe('readClusters', () => {
  it('skips and repairs bad values, since any client can write them', () => {
    const { clusters } = freshDoc();
    const raw = clusters as unknown as Y.Map<unknown>;
    raw.set('ok', { label: 'Deploys', createdAt: 5 });
    raw.set('long', { label: 'x'.repeat(500), createdAt: 6 });
    raw.set('badfields', { label: 7, createdAt: 'soon' });
    raw.set('str', 'nope');
    raw.set('nul', null);
    raw.set('arr', ['nope']);
    const byId = new Map(readClusters(clusters).map((c) => [c.id, c]));
    expect([...byId.keys()].sort()).toEqual(['badfields', 'long', 'ok']);
    expect(byId.get('ok')).toEqual({ id: 'ok', label: 'Deploys', createdAt: 5 });
    expect(byId.get('long')!.label).toHaveLength(MAX_CLUSTER_LABEL_LEN);
    expect(byId.get('badfields')).toEqual({ id: 'badfields', label: '', createdAt: 0 });
  });
});

describe('reorderTarget', () => {
  const section = [card('a'), card('b'), card('c')];

  it('moves up to before the previous card', () => {
    expect(reorderTarget(section, 'c', -1)).toEqual({ beforeId: 'b' });
  });

  it('moves down to before the card after next, or the end', () => {
    expect(reorderTarget(section, 'a', 1)).toEqual({ beforeId: 'c' });
    expect(reorderTarget(section, 'b', 1)).toEqual({ beforeId: null });
  });

  it('stops at the edges of the section', () => {
    expect(reorderTarget(section, 'a', -1)).toBeNull();
    expect(reorderTarget(section, 'c', 1)).toBeNull();
    expect(reorderTarget(section, 'missing', 1)).toBeNull();
  });
});

describe('sectionOf', () => {
  it("returns a card's lane cell, or the loose area", () => {
    const layout = layoutBoard(
      COLUMNS,
      { a: [card('1', { clusterId: 'c' }), card('2', { clusterId: 'c' }), card('3')] },
      [cluster('c', 'G')],
      ON
    );
    expect(ids(sectionOf(layout, 'a', '2'))).toEqual(['1', '2']);
    expect(ids(sectionOf(layout, 'a', '3'))).toEqual(['3']);
    expect(sectionOf(layout, 'unknown', '3')).toEqual([]);
  });
});

describe('moveCard', () => {
  function withCards(texts: string[], column = 'wentWell') {
    const state = freshDoc();
    for (const t of texts) addCard(state.board, column, t, 'u');
    return state;
  }
  const texts = (s: ReturnType<typeof freshDoc>, col = 'wentWell') => readCards(s.board, col).map((c) => c.text);
  const idOf = (s: Pick<ReturnType<typeof freshDoc>, 'board'>, text: string, col = 'wentWell') =>
    readCards(s.board, col).find((c) => c.text === text)!.id;

  it('moves up, down and to the end within a column', () => {
    const s = withCards(['a', 'b', 'c', 'd']);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'd'), 'wentWell', idOf(s, 'b'));
    expect(texts(s)).toEqual(['a', 'd', 'b', 'c']);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'wentWell', idOf(s, 'b'));
    expect(texts(s)).toEqual(['d', 'a', 'b', 'c']);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'd'), 'wentWell', null);
    expect(texts(s)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Shift+Down actually moves a card down', () => {
    const s = withCards(['a', 'b', 'c']);
    const target = reorderTarget(readCards(s.board, 'wentWell'), idOf(s, 'a'), 1)!;
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'wentWell', target.beforeId);
    expect(texts(s)).toEqual(['b', 'a', 'c']);
  });

  it('does not rebuild a card that is already in place', () => {
    const s = withCards(['a', 'b', 'c']);
    const before = s.board.get('wentWell')!.get(0);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'wentWell', idOf(s, 'a'));
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'wentWell', idOf(s, 'b'));
    expect(s.board.get('wentWell')!.get(0)).toBe(before);
    expect(texts(s)).toEqual(['a', 'b', 'c']);
  });

  it('moves across columns, before a card or to the end', () => {
    const s = withCards(['a', 'b']);
    addCard(s.board, 'toImprove', 'x', 'u');
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'toImprove', idOf(s, 'x', 'toImprove'));
    expect(texts(s, 'toImprove')).toEqual(['a', 'x']);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'b'), 'toImprove', null);
    expect(texts(s, 'toImprove')).toEqual(['a', 'x', 'b']);
    expect(texts(s)).toEqual([]);
  });

  it('falls back to the end if the target card was deleted', () => {
    const s = withCards(['a', 'b', 'c']);
    const gone = idOf(s, 'b');
    deleteCard(s.board, 'wentWell', gone);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'wentWell', gone);
    expect(texts(s)).toEqual(['c', 'a']);
  });

  it('lands next to the target card even if a peer changed the array first', () => {
    const a = withCards(['a', 'b', 'c']);
    const b = emptyDoc();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const cId = idOf(a, 'c');
    const aId = idOf(a, 'a');
    deleteCard(b.board, 'wentWell', idOf(b, 'b'));
    sync(a.doc, b.doc);
    moveCard(a.doc, a.board, 'wentWell', aId, 'wentWell', cId);
    expect(texts(a)).toEqual(['a', 'c']);
    moveCard(a.doc, a.board, 'wentWell', cId, 'wentWell', aId);
    expect(texts(a)).toEqual(['c', 'a']);
  });

  it('keeps a card in its group', () => {
    const s = withCards(['a']);
    const c = createCluster(s.clusters, 'Deploys');
    setCardCluster(s.board, 'wentWell', idOf(s, 'a'), c);
    moveCard(s.doc, s.board, 'wentWell', idOf(s, 'a'), 'toImprove', null);
    expect(readCards(s.board, 'toImprove')[0].clusterId).toBe(c);
  });
});

describe('card codec', () => {
  it('leaves clusterId off cards with no group', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<Y.Map<unknown>>('a');
    arr.push([cardToY(card('1')), cardToY(card('2', { clusterId: 'c' }))]);
    expect(arr.get(0).has('clusterId')).toBe(false);
    expect(cardFromY(arr.get(0))).not.toHaveProperty('clusterId');
    expect(cardFromY(arr.get(1))!.clusterId).toBe('c');
  });

  it('ignores a clusterId that is not a string', () => {
    const doc = new Y.Doc();
    const arr = doc.getArray<Y.Map<unknown>>('a');
    arr.push([cardToY(card('1'))]);
    arr.get(0).set('clusterId', 42);
    expect(cardFromY(arr.get(0))).not.toHaveProperty('clusterId');
  });
});

describe('cluster writers', () => {
  function setup() {
    const s = freshDoc();
    addCard(s.board, 'wentWell', 'a', 'u');
    addCard(s.board, 'toImprove', 'b', 'u');
    return { ...s, a: readCards(s.board, 'wentWell')[0].id, b: readCards(s.board, 'toImprove')[0].id };
  }

  it('creates a record with a clean label, and renames it', () => {
    const s = setup();
    const id = createCluster(s.clusters, `  ${'x'.repeat(100)}  `, 7);
    expect(readClusters(s.clusters)).toEqual([{ id, label: 'x'.repeat(MAX_CLUSTER_LABEL_LEN), createdAt: 7 }]);
    renameCluster(s.clusters, id, ' Deploys ');
    expect(readClusters(s.clusters)[0]).toEqual({ id, label: 'Deploys', createdAt: 7 });
    renameCluster(s.clusters, 'missing', 'Nope');
    expect(readClusters(s.clusters)).toHaveLength(1);
  });

  it('sets and clears a card without rebuilding it', () => {
    const s = setup();
    const before = s.board.get('wentWell')!.get(0);
    setCardCluster(s.board, 'wentWell', s.a, 'c');
    expect(readCards(s.board, 'wentWell')[0].clusterId).toBe('c');
    setCardCluster(s.board, 'wentWell', s.a, null);
    expect(readCards(s.board, 'wentWell')[0]).not.toHaveProperty('clusterId');
    expect(s.board.get('wentWell')!.get(0)).toBe(before);
  });

  it('refuses to group an action item', () => {
    const s = setup();
    s.board.set(ACTIONS_COLUMN_KEY, new Y.Array<Y.Map<unknown>>());
    addCard(s.board, ACTIONS_COLUMN_KEY, 'do it', 'u');
    const id = readCards(s.board, ACTIONS_COLUMN_KEY)[0].id;
    setCardCluster(s.board, ACTIONS_COLUMN_KEY, id, 'c');
    expect(readCards(s.board, ACTIONS_COLUMN_KEY)[0]).not.toHaveProperty('clusterId');
  });

  it('dissolves a group without touching other groups or the record', () => {
    const s = setup();
    const c = createCluster(s.clusters, 'One');
    const other = createCluster(s.clusters, 'Two');
    setCardCluster(s.board, 'wentWell', s.a, c);
    setCardCluster(s.board, 'toImprove', s.b, other);
    dissolveCluster(s.doc, s.board, c);
    expect(readCards(s.board, 'wentWell')[0]).not.toHaveProperty('clusterId');
    expect(readCards(s.board, 'toImprove')[0].clusterId).toBe(other);
    expect(s.clusters.has(c)).toBe(true);
  });

  it('merges a group into one ungrouped card, keeping votes, reactions and comments', () => {
    const s = setup();
    const c = createCluster(s.clusters, 'Deploys');
    setCardCluster(s.board, 'wentWell', s.a, c);
    setCardCluster(s.board, 'toImprove', s.b, c);
    const bY = s.board.get('toImprove')!.get(0);
    (bY.get('votes') as Y.Array<string>).push(['voter']);
    const reactions = bY.get('reactions') as Y.Map<Y.Array<string>>;
    const users = new Y.Array<string>();
    users.push(['reactor']);
    reactions.set('🎉', users);

    const into = mergeCluster(s.doc, s.board, c, ['wentWell', 'toImprove']);
    expect(into).toBe('wentWell');
    expect(readCards(s.board, 'toImprove')).toEqual([]);
    const [merged] = readCards(s.board, 'wentWell');
    expect(merged.text).toContain('a');
    expect(merged.text).toContain('b');
    expect(merged.votes).toEqual(['voter']);
    expect(merged.reactions['🎉']).toEqual(['reactor']);
    expect(merged).not.toHaveProperty('clusterId');
  });

  it('merges nothing for a group with no cards', () => {
    const s = setup();
    expect(mergeCluster(s.doc, s.board, 'empty', ['wentWell', 'toImprove'])).toBeNull();
    expect(readCards(s.board, 'wentWell')).toHaveLength(1);
  });

  it('leaves no broken group behind when a card is merged or deleted', () => {
    const s = setup();
    const c = createCluster(s.clusters, 'Deploys');
    setCardCluster(s.board, 'wentWell', s.a, c);
    setCardCluster(s.board, 'toImprove', s.b, c);
    mergeCards(s.doc, s.board, 'toImprove', s.b, 'wentWell', s.a);
    const { lanes } = layoutBoard(DEFAULT_COLUMNS, { wentWell: readCards(s.board, 'wentWell') }, readClusters(s.clusters), ON);
    expect(lanes[0].count).toBe(1);
    deleteCard(s.board, 'wentWell', s.a);
    expect(layoutBoard(DEFAULT_COLUMNS, { wentWell: readCards(s.board, 'wentWell') }, readClusters(s.clusters), ON).lanes).toEqual([]);
  });
});

describe('concurrent edits', () => {
  function twoDocs() {
    const a = freshDoc();
    addCard(a.board, 'wentWell', 'one', 'u');
    addCard(a.board, 'toImprove', 'two', 'u');
    const b = emptyDoc();
    sync(a.doc, b.doc);
    return { a, b, one: readCards(a.board, 'wentWell')[0].id, two: readCards(a.board, 'toImprove')[0].id };
  }

  it('converges when the same card is grouped into two groups at once', () => {
    const { a, b, one } = twoDocs();
    const ca = createCluster(a.clusters, 'A');
    const cb = createCluster(b.clusters, 'B');
    setCardCluster(a.board, 'wentWell', one, ca);
    setCardCluster(b.board, 'wentWell', one, cb);
    sync(a.doc, b.doc);
    const fromA = readCards(a.board, 'wentWell')[0].clusterId;
    expect(fromA).toBe(readCards(b.board, 'wentWell')[0].clusterId);
    expect([ca, cb]).toContain(fromA);
  });

  it('keeps both a rename and a join', () => {
    const { a, b, one, two } = twoDocs();
    const c = createCluster(a.clusters, 'Old');
    setCardCluster(a.board, 'wentWell', one, c);
    sync(a.doc, b.doc);
    renameCluster(a.clusters, c, 'New');
    setCardCluster(b.board, 'toImprove', two, c);
    sync(a.doc, b.doc);
    expect(readClusters(b.clusters)[0].label).toBe('New');
    expect(readCards(a.board, 'toImprove')[0].clusterId).toBe(c);
  });

  it('keeps a comment or vote made while someone else groups the card', () => {
    const { a, b, one } = twoDocs();
    const c = createCluster(a.clusters, 'G');
    setCardCluster(a.board, 'wentWell', one, c);
    (b.board.get('wentWell')!.get(0).get('votes') as Y.Array<string>).push(['voter']);
    sync(a.doc, b.doc);
    const [card] = readCards(a.board, 'wentWell');
    expect(card.clusterId).toBe(c);
    expect(card.votes).toEqual(['voter']);
  });
});
