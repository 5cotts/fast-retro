import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export type ColumnKey = 'wentWell' | 'toImprove' | 'actions';

export const COLUMNS: { key: ColumnKey; title: string; accent: string }[] = [
  { key: 'wentWell', title: 'Went Well', accent: 'border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-700/40' },
  { key: 'toImprove', title: 'To Improve', accent: 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700/40' },
  { key: 'actions', title: 'Action Items', accent: 'border-sky-400/60 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-700/40' }
];

export const REACTION_EMOJI = ['👍', '❤️', '🎉', '😂', '😢', '🤔'] as const;
export type ReactionEmoji = typeof REACTION_EMOJI[number];

export interface CommentData {
  id: string;
  text: string;
  authorId: string;
  createdAt: number;
}

export interface CardData {
  id: string;
  text: string;
  authorId: string;
  votes: string[];
  reactions: Record<string, string[]>;
  comments: CommentData[];
}

export interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
  isLead: boolean;
  typing?: string | null;
}

export interface TimerState {
  durationSec: number;
  startedAt: number | null;
  paused: boolean;
  pausedRemaining: number | null;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

export function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function buildWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function getOrCreateUserId(): string {
  const key = 'retro-user-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = newId();
    localStorage.setItem(key, id);
  }
  return id;
}

export interface BoardState {
  doc: Y.Doc;
  provider: WebsocketProvider;
  board: Y.Map<Y.Array<Y.Map<unknown>>>;
  timer: Y.Map<unknown>;
  names: Y.Map<string>;
}

export function createBoard(roomName = 'global'): BoardState {
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

export function setDisplayName(names: Y.Map<string>, userId: string, name: string) {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return;
  if (names.get(userId) !== trimmed) names.set(userId, trimmed);
}

export function readNames(names: Y.Map<string>): Record<string, string> {
  const out: Record<string, string> = {};
  names.forEach((v, k) => {
    if (typeof v === 'string' && v) out[k] = v;
  });
  return out;
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

export function readTimer(timer: Y.Map<unknown>): TimerState {
  const durationSec = (timer.get('durationSec') as number | undefined) ?? 0;
  const startedAt = (timer.get('startedAt') as number | null | undefined) ?? null;
  const paused = !!timer.get('paused');
  const pausedRemaining = (timer.get('pausedRemaining') as number | null | undefined) ?? null;
  return { durationSec, startedAt, paused, pausedRemaining };
}

export function setTimerDuration(timer: Y.Map<unknown>, seconds: number) {
  timer.set('durationSec', Math.max(0, Math.floor(seconds)));
  timer.set('startedAt', null);
  timer.set('paused', false);
  timer.set('pausedRemaining', null);
}

export function startTimer(timer: Y.Map<unknown>) {
  const state = readTimer(timer);
  if (state.durationSec <= 0) return;
  if (state.paused && state.pausedRemaining !== null) {
    timer.set('startedAt', Date.now());
    timer.set('durationSec', state.pausedRemaining);
    timer.set('paused', false);
    timer.set('pausedRemaining', null);
    return;
  }
  timer.set('startedAt', Date.now());
  timer.set('paused', false);
  timer.set('pausedRemaining', null);
}

export function pauseTimer(timer: Y.Map<unknown>) {
  const state = readTimer(timer);
  if (state.startedAt === null || state.paused) return;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const remaining = Math.max(0, state.durationSec - elapsed);
  timer.set('paused', true);
  timer.set('pausedRemaining', remaining);
  timer.set('startedAt', null);
}

export function resetTimer(timer: Y.Map<unknown>) {
  timer.set('startedAt', null);
  timer.set('paused', false);
  timer.set('pausedRemaining', null);
}

export function computeTimerRemaining(state: TimerState, now: number): number {
  if (state.paused && state.pausedRemaining !== null) return state.pausedRemaining;
  if (state.startedAt === null) return state.durationSec;
  const elapsed = Math.floor((now - state.startedAt) / 1000);
  return Math.max(0, state.durationSec - elapsed);
}

export function formatMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

export function exportCSV(boardSnapshot: Record<ColumnKey, CardData[]>): string {
  const rows: string[][] = [['column', 'card_text', 'votes', 'reactions', 'comments']];
  for (const col of COLUMNS) {
    for (const card of boardSnapshot[col.key]) {
      const reactionStr = Object.entries(card.reactions)
        .filter(([, users]) => users.length > 0)
        .map(([emoji, users]) => `${emoji}:${users.length}`)
        .join(' ');
      const commentsStr = card.comments
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((c) => c.text)
        .join(' | ');
      rows.push([col.title, card.text, String(card.votes.length), reactionStr, commentsStr]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
