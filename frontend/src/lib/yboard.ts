import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { CardData, CommentData, ColumnKey } from './types';
import { newId } from './identity';

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
}

export function createBoard(): BoardState {
  const doc = new Y.Doc();
  const wsUrl = buildWsUrl();
  const base = wsUrl.replace(/\/ws$/, '');
  const provider = new WebsocketProvider(base, 'ws', doc, { connect: true });

  const board = doc.getMap<Y.Array<Y.Map<unknown>>>('board');
  const timer = doc.getMap<unknown>('timer');
  const names = doc.getMap<string>('names');

  doc.transact(() => {
    for (const col of ['wentWell', 'toImprove', 'actions'] as const) {
      if (!board.has(col)) {
        board.set(col, new Y.Array<Y.Map<unknown>>());
      }
    }
  });

  return { doc, provider, board, timer, names };
}

function makeCard(text: string, authorId: string): Y.Map<unknown> {
  const card = new Y.Map<unknown>();
  card.set('id', newId());
  card.set('text', text);
  card.set('authorId', authorId);
  card.set('votes', new Y.Array<string>());
  card.set('reactions', new Y.Map<Y.Array<string>>());
  card.set('comments', new Y.Array<Y.Map<unknown>>());
  return card;
}

export function addCard(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: ColumnKey,
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
    for (const col of ['wentWell', 'toImprove', 'actions'] as const) {
      const arr = board.get(col);
      if (arr && arr.length > 0) arr.delete(0, arr.length);
    }
    timer.set('durationSec', 0);
    timer.set('startedAt', null);
    timer.set('paused', false);
    timer.set('pausedRemaining', null);
  });
}

export function editCardText(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: ColumnKey,
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
  column: ColumnKey,
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
  column: ColumnKey,
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
  column: ColumnKey,
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
  column: ColumnKey,
  cardId: string,
  text: string,
  authorId: string
) {
  const arr = board.get(column);
  if (!arr) return;
  arr.forEach((card) => {
    if (card.get('id') !== cardId) return;
    const comments = card.get('comments') as Y.Array<Y.Map<unknown>>;
    const c = new Y.Map<unknown>();
    c.set('id', newId());
    c.set('text', text);
    c.set('authorId', authorId);
    c.set('createdAt', Date.now());
    comments.push([c]);
  });
}

export function deleteComment(
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  column: ColumnKey,
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

// Known limitation: moveCard snapshots the source card and rebuilds it at the
// destination because Y.Array doesn't expose an atomic move. If two clients
// move the same card concurrently, both may insert a rehydrated copy and the
// CRDT merge will keep both — manifesting as a duplicated card that callers
// must clean up. In practice this is rare for retro boards (small N of users,
// short-lived sessions) and not worth a custom CRDT for now.
export function moveCard(
  doc: Y.Doc,
  board: Y.Map<Y.Array<Y.Map<unknown>>>,
  fromCol: ColumnKey,
  cardId: string,
  toCol: ColumnKey,
  toIndex: number
) {
  doc.transact(() => {
    const fromArr = board.get(fromCol);
    const toArr = board.get(toCol);
    if (!fromArr || !toArr) return;
    let fromIdx = -1;
    let snapshot: { id: string; text: string; authorId: string; votes: string[]; reactions: Record<string, string[]>; comments: CommentData[] } | null = null;
    fromArr.forEach((card, i) => {
      if (card.get('id') !== cardId) return;
      fromIdx = i;
      const votes = (card.get('votes') as Y.Array<string>).toArray();
      const reactionsMap = card.get('reactions') as Y.Map<Y.Array<string>>;
      const reactions: Record<string, string[]> = {};
      reactionsMap.forEach((users, emoji) => {
        reactions[emoji] = users.toArray();
      });
      const commentsArr = card.get('comments') as Y.Array<Y.Map<unknown>>;
      const comments: CommentData[] = [];
      commentsArr.forEach((c) => {
        const id = c.get('id');
        const text = c.get('text');
        const createdAt = c.get('createdAt');
        const authorId = (c.get('authorId') as string | undefined) ?? '';
        if (typeof id === 'string' && typeof text === 'string' && typeof createdAt === 'number') {
          comments.push({ id, text, authorId, createdAt });
        }
      });
      snapshot = {
        id: card.get('id') as string,
        text: card.get('text') as string,
        authorId: (card.get('authorId') as string | undefined) ?? '',
        votes,
        reactions,
        comments
      };
    });

    if (fromIdx < 0 || !snapshot) return;

    if (fromCol === toCol) {
      const current = toIndex;
      if (current === fromIdx) return;
      fromArr.delete(fromIdx, 1);
      const insertAt = current > fromIdx ? current - 1 : current;
      fromArr.insert(Math.max(0, Math.min(insertAt, fromArr.length)), [rehydrateCard(snapshot)]);
    } else {
      fromArr.delete(fromIdx, 1);
      const clamped = Math.max(0, Math.min(toIndex, toArr.length));
      toArr.insert(clamped, [rehydrateCard(snapshot)]);
    }
  });
}

function rehydrateCard(snap: {
  id: string;
  text: string;
  authorId: string;
  votes: string[];
  reactions: Record<string, string[]>;
  comments: CommentData[];
}): Y.Map<unknown> {
  const card = new Y.Map<unknown>();
  card.set('id', snap.id);
  card.set('text', snap.text);
  card.set('authorId', snap.authorId);
  const votes = new Y.Array<string>();
  if (snap.votes.length) votes.push(snap.votes);
  card.set('votes', votes);
  const reactions = new Y.Map<Y.Array<string>>();
  for (const [emoji, users] of Object.entries(snap.reactions)) {
    const ya = new Y.Array<string>();
    if (users.length) ya.push(users);
    reactions.set(emoji, ya);
  }
  card.set('reactions', reactions);
  const comments = new Y.Array<Y.Map<unknown>>();
  for (const c of snap.comments) {
    const cm = new Y.Map<unknown>();
    cm.set('id', c.id);
    cm.set('text', c.text);
    cm.set('authorId', c.authorId);
    cm.set('createdAt', c.createdAt);
    comments.push([cm]);
  }
  card.set('comments', comments);
  return card;
}

export function readCards(board: Y.Map<Y.Array<Y.Map<unknown>>>, column: ColumnKey): CardData[] {
  const arr = board.get(column);
  if (!arr) return [];
  const out: CardData[] = [];
  arr.forEach((card) => {
    const id = card.get('id');
    const text = card.get('text');
    if (typeof id !== 'string' || typeof text !== 'string') return;
    const authorId = (card.get('authorId') as string | undefined) ?? '';
    const votesArr = card.get('votes') as Y.Array<string> | undefined;
    const votes = votesArr ? votesArr.toArray() : [];
    const reactionsMap = card.get('reactions') as Y.Map<Y.Array<string>> | undefined;
    const reactions: Record<string, string[]> = {};
    if (reactionsMap) {
      reactionsMap.forEach((users, emoji) => {
        reactions[emoji] = users.toArray();
      });
    }
    const commentsArr = card.get('comments') as Y.Array<Y.Map<unknown>> | undefined;
    const comments: CommentData[] = [];
    if (commentsArr) {
      commentsArr.forEach((c) => {
        const cid = c.get('id');
        const ctext = c.get('text');
        const createdAt = c.get('createdAt');
        const authorId = (c.get('authorId') as string | undefined) ?? '';
        if (typeof cid === 'string' && typeof ctext === 'string' && typeof createdAt === 'number') {
          comments.push({ id: cid, text: ctext, authorId, createdAt });
        }
      });
    }
    out.push({ id, text, authorId, votes, reactions, comments });
  });
  return out;
}
