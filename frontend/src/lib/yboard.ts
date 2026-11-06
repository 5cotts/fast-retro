import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { CardData, CardPos } from './types';
import { cardFromY, cardToY, commentToY } from './cardcodec';
import { cleanClusterLabel, clusterMapOf, type ClusterMap } from './clusters';
import { ACTIONS_COLUMN_KEY, DEFAULT_COLUMNS, diffColumns, hasActionsColumn, readColumns, sameColumns, type ColumnDef, type ColumnDiff } from './columns';
import { BOARD_SETTING_KEYS, readBoardSetting, setBoardSetting, type BoardSettings } from './settings';
import { newId } from './identity';
import { readPhase, setPhase } from './phase';
import { boardFileColumns, type BoardFile } from './boardfile';

export function buildWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export interface BoardState {
  doc: Y.Doc;
  provider: WebsocketProvider;
  board: Y.Map<Y.Array<Y.Map<unknown>>>;
  timer: Y.Map<unknown>;
  names: Y.Map<string>;
  phase: Y.Map<unknown>;
  meta: Y.Map<unknown>;
  clusters: ClusterMap;
  slug: string;
}

// A new board's first contents: a board file plus where it came from. Every
// new board is set up this way (blank, imported or "next retro"), so there is
// one setup path instead of one per feature.
export interface PendingSeed {
  file: BoardFile;
  origin: SeedOrigin;
}

export interface SeedSource {
  // Called once, after the first sync. Returns the seed to apply, if any.
  take: () => PendingSeed | null;
  onApplied?: (seed: PendingSeed) => void;
}

export function createBoard(slug: string, seed?: SeedSource): BoardState {
  const doc = new Y.Doc();
  const wsUrl = buildWsUrl();
  const base = wsUrl.replace(/\/ws$/, '');
  const provider = new WebsocketProvider(base, 'ws', doc, {
    connect: true,
    params: { board: slug },
    // y-websocket's cross-tab BroadcastChannel sync is keyed by `serverUrl +
    // '/' + roomname` — NOT by the `board` query param. Every board on this
    // origin uses the same hardcoded roomname ('ws', required so the actual
    // WebSocket URL still resolves to the server's /ws route), so with BC
    // enabled, any two tabs open on *different* boards at the same time sync
    // their Yjs docs directly with each other, bypassing the server's
    // per-slug room separation entirely — confirmed live: opening two
    // unrelated boards in separate tabs caused one to inherit the other's
    // label/phase/presence immediately, and card data intermittently (same
    // Y.Map last-write-wins race as the reload bug above). The server
    // round-trip already provides real-time sync, so this same-browser
    // optimization isn't needed — just turn it off.
    disableBc: true
  });

  const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
  const timer = doc.getMap<unknown>('timer');
  const names = doc.getMap<string>('names');
  const phase = doc.getMap<unknown>('phase');
  const meta = doc.getMap<unknown>('meta');
  const clusters = clusterMapOf(doc);

  // Wait for the initial server sync before deciding which columns are
  // "missing" and need a default empty array. Setting defaults eagerly
  // (before this doc has merged in the server's state) races the server's
  // real column data: Y.Map resolves concurrent writes to the same key via
  // an effectively random per-doc client-ID tie-break, so a fresh client's
  // pre-sync empty array can — and empirically does, roughly half the time —
  // beat an existing column full of cards, wiping it once the empty state
  // gets synced back and persisted.
  //
  // The seed goes in the same transaction and *before* the ensure loop, so a
  // board's column list and its arrays always arrive together, and nothing
  // ever creates a column array lazily (the same race, for any column).
  provider.once('sync', () => {
    const pending = seed?.take() ?? null;
    if (setUpAfterSync({ doc, board, meta, names, phase }, pending) && pending) seed?.onApplied?.(pending);
  });

  return { doc, provider, board, timer, names, phase, meta, clusters, slug };
}

// Runs once per client after the first sync: applies the seed (only to a
// board that's still empty and has no column list), then makes sure every
// column has its array. Returns whether the seed was applied.
export function setUpAfterSync(
  state: Pick<BoardState, 'doc' | 'board' | 'meta' | 'names' | 'phase'>,
  pending: PendingSeed | null
): boolean {
  const { doc, board, meta } = state;
  let applied = false;
  doc.transact(() => {
    if (pending && isBoardEmpty(board) && !meta.has('columns')) {
      seedBoard(state, pending.file, pending.origin);
      applied = true;
    }
    for (const col of readColumns(meta)) {
      if (!board.has(col.key)) {
        board.set(col.key, new Y.Array<Y.Map<unknown>>());
      }
    }
  });
  return applied;
}

const MAX_LABEL_LEN = 60;

export function readBoardLabel(meta: Y.Map<unknown>): string {
  const v = meta.get('label');
  return typeof v === 'string' ? v : '';
}

export function setBoardLabel(meta: Y.Map<unknown>, label: string): void {
  const t = label.trim().slice(0, MAX_LABEL_LEN);
  if (t) {
    meta.set('label', t);
  } else {
    meta.delete('label');
  }
}

// Shorthands for the settings registry (settings.ts).
export const readBoardAnonymous = (meta: Y.Map<unknown>) => readBoardSetting(meta, 'anonymous');
export const readBoardAutoSort = (meta: Y.Map<unknown>) => readBoardSetting(meta, 'autoSort');

// Where an imported board came from, shown as a small note in the header.
// The file is untrusted (it chooses which user IDs own cards and votes), so
// imported boards say so. Set once by seedBoard; never exported.
export type ImportOrigin = { kind: 'file' } | { kind: 'carryover'; from: string };
// A blank new board is seeded too, but isn't "imported".
export type SeedOrigin = ImportOrigin | { kind: 'new' };

export interface ImportedInfo {
  origin: ImportOrigin;
  at: number;
}

export function readBoardImported(meta: Y.Map<unknown>): ImportedInfo | null {
  const at = meta.get('importedAt');
  const kind = meta.get('importedKind');
  if (typeof at !== 'number') return null;
  if (kind === 'carryover') {
    const from = meta.get('importedFrom');
    return { origin: { kind, from: typeof from === 'string' ? from : '' }, at };
  }
  return { origin: { kind: 'file' }, at };
}

function setBoardImported(meta: Y.Map<unknown>, origin: ImportOrigin, at: number): void {
  meta.set('importedAt', at);
  meta.set('importedKind', origin.kind);
  if (origin.kind === 'carryover' && origin.from) meta.set('importedFrom', origin.from.slice(0, 60));
  else meta.delete('importedFrom');
}

// Live "the retro just ended" signal, broadcast over the same meta channel so
// every connected client (not just the lead who clicked End) can react —
// confetti burst, motivational toast — without needing to reload. Set this
// *before* the archive REST call that flips the room to read-only server
// side; once that happens, the server silently drops further doc writes, so
// writing after the call would race a channel that's about to go deaf.
export function readBoardEndedAt(meta: Y.Map<unknown>): number | null {
  const v = meta.get('endedAt');
  return typeof v === 'number' ? v : null;
}

export function readBoardEndedMessage(meta: Y.Map<unknown>): string {
  const v = meta.get('endedMessage');
  return typeof v === 'string' ? v : '';
}

export interface BoardEdit {
  label?: string;
  columns?: ColumnDef[];
  settings?: Partial<BoardSettings>;
}

export interface BoardEditResult extends ColumnDiff {
  settingsChanged: number;
}

// The one writer for "Edit board" (the dialog and inline column rename). It
// all lands in one transaction, so peers see a single change.
//
// A removed column's array is emptied but kept in the board map, never
// deleted. meta.columns is last-writer-wins, so another host tab saving an
// older list could bring the column back; it must still have an array behind
// it (addCard does nothing on a column without one). Keeping the array also
// lets Action items be turned back on without recreating the 'actions' key,
// which two clients could race on (see createBoard). New columns get fresh
// random keys, so only this client ever creates their arrays.
export function applyBoardEdit(
  state: Pick<BoardState, 'doc' | 'board' | 'meta' | 'phase'>,
  edit: BoardEdit
): BoardEditResult {
  const { doc, board, meta, phase } = state;
  const prev = readColumns(meta);
  const next = edit.columns ?? prev;
  const diff = diffColumns(prev, next);
  let settingsChanged = 0;
  doc.transact(() => {
    if (edit.label !== undefined && edit.label.trim() !== readBoardLabel(meta)) setBoardLabel(meta, edit.label);
    for (const key of BOARD_SETTING_KEYS) {
      const v = edit.settings?.[key];
      if (v === undefined || v === readBoardSetting(meta, key)) continue;
      setBoardSetting(meta, key, v);
      settingsChanged++;
    }
    if (!edit.columns) return;
    if (!sameColumns(prev, next)) {
      if (sameColumns(next, DEFAULT_COLUMNS)) meta.delete('columns');
      else meta.set('columns', next.map((c) => ({ ...c })));
    }
    for (const col of next) {
      if (!board.has(col.key)) board.set(col.key, new Y.Array<Y.Map<unknown>>());
    }
    for (const col of diff.removed) {
      const arr = board.get(col.key);
      if (arr && arr.length > 0) arr.delete(0, arr.length);
    }
    if (!hasActionsColumn(next) && readPhase(phase) === 'actions') setPhase(phase, 'discuss');
  });
  return { ...diff, settingsChanged };
}

function makeCard(text: string, authorId: string): Y.Map<unknown> {
  return cardToY({ id: newId(), text, authorId, votes: [], reactions: {}, comments: [] });
}

export function addCard(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  text: string,
  authorId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.push([makeCard(text, authorId)]);
}

export function resetBoard(
  doc: Y.Doc,
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  timer: Y.Map<unknown>
) {
  doc.transact(() => {
    board.forEach((arr) => {
      if (arr.length > 0) arr.delete(0, arr.length);
    });
    timer.set('durationSec', 0);
    timer.set('startedAt', null);
    timer.set('paused', false);
    timer.set('pausedRemaining', null);
  });
}

export function editCardText(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  text: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.forEach((card) => {
    if (card.get('id') === cardId) {
      card.set('text', text);
    }
  });
}

export function deleteCard(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  let idx = -1;
  arr.forEach((card, i) => {
    if (card.get('id') === cardId) idx = i;
  });
  if (idx >= 0) arr.delete(idx, 1);
}

export function toggleVote(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  userId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.forEach((card) => {
    if (card.get('id') !== cardId) return;
    const votes = card.get('votes') as Y.Array<string>;
    let existingIdx = -1;
    votes.forEach((v, i) => {
      if (v === userId) existingIdx = i;
    });
    if (existingIdx >= 0) votes.delete(existingIdx, 1);
    else votes.push([userId]);
  });
}

export function toggleReaction(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  emoji: string,
  userId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.forEach((card) => {
    if (card.get('id') !== cardId) return;
    const reactions = card.get('reactions') as Y.Map<Y.Array<string>>;
    let users = reactions.get(emoji);
    if (!users) {
      users = new Y.Array<string>();
      reactions.set(emoji, users);
    }
    let existingIdx = -1;
    users.forEach((u, i) => {
      if (u === userId) existingIdx = i;
    });
    if (existingIdx >= 0) {
      users.delete(existingIdx, 1);
      if (users.length === 0) reactions.delete(emoji);
    } else {
      users.push([userId]);
    }
  });
}

export function addComment(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  text: string,
  authorId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.forEach((card) => {
    if (card.get('id') !== cardId) return;
    const comments = card.get('comments') as Y.Array<Y.Map<unknown>>;
    comments.push([commentToY({ id: newId(), text, authorId, createdAt: Date.now() })]);
  });
}

export function deleteComment(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  commentId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.forEach((card) => {
    if (card.get('id') !== cardId) return;
    const comments = card.get('comments') as Y.Array<Y.Map<unknown>>;
    let idx = -1;
    comments.forEach((c, i) => {
      if (c.get('id') === commentId) idx = i;
    });
    if (idx >= 0) comments.delete(idx, 1);
  });
}

// Last match wins, as it always has: a concurrent move can leave a duplicate
// card behind (see moveCard), and callers have always acted on the later copy.
function lastIndexOfCard(arr: Y.Array<Y.Map<unknown>>, cardId: string): number {
  let idx = -1;
  arr.forEach((card, i) => {
    if (card.get('id') === cardId) idx = i;
  });
  return idx;
}

// Moves a card to just before beforeId, or to the end of toCol when beforeId is
// null or no longer there. It takes a card rather than an index because what's
// on screen isn't always in array order, and a peer can change the array
// mid-drag; the position is looked up here, at drop time.
//
// Known limitation: moveCard snapshots the source card and rebuilds it at the
// destination because Y.Array doesn't expose an atomic move. If two clients
// move the same card concurrently, both may insert a rehydrated copy and the
// CRDT merge will keep both — manifesting as a duplicated card that callers
// must clean up. In practice this is rare for retro boards (small N of users,
// short-lived sessions) and not worth a custom CRDT for now.
export function moveCard(
  doc: Y.Doc,
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  fromCol: string,
  cardId: string,
  toCol: string,
  beforeId: string | null
) {
  if (beforeId === cardId) return;
  doc.transact(() => {
    const fromArr = board.get(fromCol);
    const toArr = board.get(toCol);
    if (!fromArr || !toArr) return;
    const fromIdx = lastIndexOfCard(fromArr, cardId);
    const snapshot = fromIdx >= 0 ? cardFromY(fromArr.get(fromIdx)) : null;
    if (!snapshot) return;

    const beforeIdx = beforeId === null ? -1 : lastIndexOfCard(toArr, beforeId);
    let insertAt = beforeIdx < 0 ? toArr.length : beforeIdx;
    if (fromCol === toCol) {
      // Already there, so don't rebuild the card.
      if (insertAt === fromIdx + 1) return;
      if (insertAt > fromIdx) insertAt--;
    }
    fromArr.delete(fromIdx, 1);
    toArr.insert(insertAt, [cardToY(snapshot)]);
  });
}

// Merge source card into target: union votes, union reactions per emoji,
// append comments in createdAt order, append source text after a separator,
// then delete the source. Runs in a single Yjs transaction so peers see the
// post-merge state in one tick (no flicker where the source vanishes before
// the target absorbs it).
export function mergeCards(
  doc: Y.Doc,
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  fromCol: string,
  fromId: string,
  toCol: string,
  toId: string
) {
  if (fromId === toId && fromCol === toCol) return;
  doc.transact(() => {
    const fromArr = board.get(fromCol);
    const toArr = board.get(toCol);
    if (!fromArr || !toArr) return;

    const fromIdx = lastIndexOfCard(fromArr, fromId);
    const source = fromIdx >= 0 ? cardFromY(fromArr.get(fromIdx)) : null;
    if (!source) return;

    let merged = false;
    toArr.forEach((card) => {
      if (merged) return;
      if (card.get('id') !== toId) return;
      merged = true;
      const toText = (card.get('text') as string | undefined) ?? '';
      const trimmedFrom = source.text.trim();
      if (trimmedFrom.length > 0) {
        const sep = toText.endsWith('\n') ? '— — —\n' : '\n— — —\n';
        card.set('text', `${toText}${sep}${trimmedFrom}`);
      }

      const toVotes = card.get('votes') as Y.Array<string>;
      const existing = new Set(toVotes.toArray());
      const toAdd = source.votes.filter((v) => !existing.has(v));
      if (toAdd.length) toVotes.push(toAdd);

      const toReactions = card.get('reactions') as Y.Map<Y.Array<string>>;
      for (const [emoji, users] of Object.entries(source.reactions)) {
        let bucket = toReactions.get(emoji);
        if (!bucket) {
          bucket = new Y.Array<string>();
          toReactions.set(emoji, bucket);
        }
        const have = new Set(bucket.toArray());
        const adds = users.filter((u) => !have.has(u));
        if (adds.length) bucket.push(adds);
      }

      const toComments = card.get('comments') as Y.Array<Y.Map<unknown>>;
      const fromComments = [...source.comments].sort((a, b) => a.createdAt - b.createdAt);
      for (const c of fromComments) toComments.push([commentToY(c)]);
    });

    if (!merged) return;
    fromArr.delete(fromIdx, 1);
  });
}

export function createCluster(clusters: ClusterMap, label = '', now = Date.now()): string {
  const id = newId();
  clusters.set(id, { label: cleanClusterLabel(label), createdAt: now });
  return id;
}

export function renameCluster(clusters: ClusterMap, clusterId: string, label: string): void {
  const existing = clusters.get(clusterId);
  if (!existing) return;
  clusters.set(clusterId, { ...existing, label: cleanClusterLabel(label) });
}

// A single last-writer-wins field that doesn't rebuild the card, so it avoids
// the duplicate-card race documented on moveCard. Action items can't be grouped.
export function setCardCluster(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  clusterId: string | null
): void {
  if (column === ACTIONS_COLUMN_KEY) return;
  board.get(column)?.forEach((card) => {
    if (card.get('id') !== cardId) return;
    if (clusterId) card.set('clusterId', clusterId);
    else card.delete('clusterId');
  });
}

// One last-writer-wins field per drop. It doesn't rebuild the card, so a move
// and a concurrent comment or vote both survive, and it can't duplicate a card
// the way moveCard can.
export function setCardPos(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: string,
  cardId: string,
  pos: CardPos
): void {
  board.get(column)?.forEach((card) => {
    if (card.get('id') === cardId) card.set('pos', { x: pos.x, y: pos.y, z: pos.z });
  });
}

// Puts every member back in the ungrouped area. The record stays (see clusters.ts).
export function dissolveCluster(doc: Y.Doc, board: Y.Map<Y.Array<Y.Map<unknown>>>, clusterId: string): void {
  doc.transact(() => {
    board.forEach((arr) => {
      arr.forEach((card) => {
        if (card.get('clusterId') === clusterId) card.delete('clusterId');
      });
    });
  });
}

// The explicit, destructive merge: every member becomes one card, in the first
// of columnKeys that has a member. Returns that column, or null if there was
// nothing to merge.
export function mergeCluster(
  doc: Y.Doc,
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  clusterId: string,
  columnKeys: string[]
): string | null {
  const members = columnKeys.flatMap((column) =>
    readCards(board, column)
      .filter((card) => card.clusterId === clusterId)
      .map((card) => ({ column, id: card.id }))
  );
  if (members.length === 0) return null;
  const [survivor, ...rest] = members;
  doc.transact(() => {
    for (const m of rest) mergeCards(doc, board, m.column, m.id, survivor.column, survivor.id);
    setCardCluster(board, survivor.column, survivor.id, null);
  });
  return survivor.column;
}

export function readCards(board: Y.Map<Y.Array<Y.Map<unknown>>>, column: string): CardData[] {
  const arr = board.get(column);
  if (!arr) return [];
  const out: CardData[] = [];
  arr.forEach((card) => {
    const parsed = cardFromY(card);
    if (parsed) out.push(parsed);
  });
  return out;
}

// Every column array in the doc, keyed by column key. Readers that render or
// export pick the keys they need from the board's column list; stray arrays
// are harmless.
export function readAllCards(board: Y.Map<Y.Array<Y.Map<unknown>>>): Record<string, CardData[]> {
  const out: Record<string, CardData[]> = {};
  board.forEach((_arr, key) => {
    out[key] = readCards(board, key);
  });
  return out;
}

export function countCards(cards: Record<string, CardData[]>): number {
  let n = 0;
  for (const list of Object.values(cards)) n += list.length;
  return n;
}

export function isBoardEmpty(board: Y.Map<Y.Array<Y.Map<unknown>>>): boolean {
  let empty = true;
  board.forEach((arr) => {
    if (arr.length > 0) empty = false;
  });
  return empty;
}

// Writes a board file into a (normally empty, already-synced) board in one
// transaction, so peers and the server get it as a single update.
// Card and comment IDs are regenerated: importing the same file twice must not
// produce duplicate IDs, which mergeCards/moveCard lookups assume are unique.
// User IDs are kept so a returning participant still owns their cards and votes.
export function seedBoard(
  state: Pick<BoardState, 'doc' | 'board' | 'meta' | 'names' | 'phase'>,
  file: BoardFile,
  origin: SeedOrigin = { kind: 'file' },
  now = Date.now()
): void {
  const { doc, board, meta, names, phase } = state;
  const columns = boardFileColumns(file);
  const clusters = clusterMapOf(doc);
  doc.transact(() => {
    // Group IDs are regenerated like card IDs. createdAt keeps the file's order.
    const clusterIds = new Map<string, string>();
    (file.board.clusters ?? []).forEach((c, i) => {
      clusterIds.set(c.id, createCluster(clusters, c.label, now + i));
    });
    // The column list and every column's array land in this one transaction
    // (see setUpAfterSync). Classic boards store no list.
    if (!sameColumns(columns, DEFAULT_COLUMNS)) meta.set('columns', columns.map((c) => ({ ...c })));
    for (const col of columns) {
      let arr = board.get(col.key);
      if (!arr) {
        arr = new Y.Array<Y.Map<unknown>>();
        board.set(col.key, arr);
      }
      const cards = (file.cards[col.key] ?? []).map((card) => {
        const { clusterId, ...rest } = card;
        const mapped = clusterId ? clusterIds.get(clusterId) : undefined;
        return cardToY({
          ...rest,
          id: newId(),
          comments: card.comments.map((c) => ({ ...c, id: newId() })),
          ...(mapped ? { clusterId: mapped } : {})
        });
      });
      if (cards.length) arr.push(cards);
    }
    if (file.board.layout === 'canvas') meta.set('layout', 'canvas');
    setBoardLabel(meta, file.board.label);
    setBoardSetting(meta, 'anonymous', file.board.anonymous);
    setBoardSetting(meta, 'autoSort', file.board.autoSort);
    setBoardSetting(meta, 'hideCards', file.board.hideCards === true);
    setPhase(phase, file.board.phase);
    if (origin.kind !== 'new') setBoardImported(meta, origin, now);
    if (!file.board.anonymous && file.names) {
      for (const [id, name] of Object.entries(file.names)) {
        if (!names.has(id)) names.set(id, name);
      }
    }
  });
}
