import type { CardData, ColumnKey, CommentData } from './types';
import { COLUMNS } from './types';
import { PHASES, type Phase } from './phase';

// Round-trippable board export. `cards` deliberately matches the archive
// snapshot shape (`BoardCardsSnapshot` in src/archive.rs) so archives and live
// boards export through the same code. See docs/import-board-plan.md.
export const BOARD_FILE_FORMAT = 'fast-retro';
export const BOARD_FILE_VERSION = 1;
export const BOARD_FILE_EXTENSION = '.fastretro.json';

export interface BoardFile {
  format: typeof BOARD_FILE_FORMAT;
  version: number;
  exportedAt: number;
  board: {
    label: string;
    anonymous: boolean;
    phase: Phase;
    autoSort: boolean;
  };
  names?: Record<string, string>;
  cards: Record<ColumnKey, CardData[]>;
}

export interface BoardFileSource {
  label: string;
  anonymous: boolean;
  phase: Phase;
  autoSort: boolean;
  cards: Record<ColumnKey, CardData[]>;
  namesMap: Record<string, string>;
}

export function isPhase(v: unknown): v is Phase {
  return typeof v === 'string' && (PHASES as readonly string[]).includes(v);
}

function referencedUserIds(cards: Record<ColumnKey, CardData[]>): Set<string> {
  const ids = new Set<string>();
  for (const col of COLUMNS) {
    for (const card of cards[col.key] ?? []) {
      if (card.authorId) ids.add(card.authorId);
      for (const v of card.votes) ids.add(v);
      for (const users of Object.values(card.reactions)) for (const u of users) ids.add(u);
      for (const c of card.comments) if (c.authorId) ids.add(c.authorId);
    }
  }
  return ids;
}

function copyCards(cards: Record<ColumnKey, CardData[]>): Record<ColumnKey, CardData[]> {
  const out = { wentWell: [], toImprove: [], actions: [] } as Record<ColumnKey, CardData[]>;
  for (const col of COLUMNS) {
    out[col.key] = (cards[col.key] ?? []).map((card) => ({
      id: card.id,
      text: card.text,
      authorId: card.authorId,
      votes: [...card.votes],
      reactions: Object.fromEntries(
        Object.entries(card.reactions)
          .filter(([, users]) => users.length > 0)
          .map(([emoji, users]) => [emoji, [...users]])
      ),
      comments: card.comments.map((c) => ({ ...c }))
    }));
  }
  return out;
}

export function exportBoardFile(src: BoardFileSource, now = Date.now()): BoardFile {
  const cards = copyCards(src.cards);
  const file: BoardFile = {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    exportedAt: now,
    board: {
      label: src.label,
      anonymous: src.anonymous,
      phase: src.phase,
      autoSort: src.autoSort
    },
    cards
  };
  // An anonymous board's file must never carry real names; otherwise only
  // keep names for people who actually appear on the board.
  if (!src.anonymous) {
    const names: Record<string, string> = {};
    for (const id of referencedUserIds(cards)) {
      const name = src.namesMap[id];
      if (name) names[id] = name;
    }
    file.names = names;
  }
  return file;
}

export function serializeBoardFile(file: BoardFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

// Filename stem shared by every download for a board: the label slugified, or
// `retro` when unnamed, plus a timestamp so repeated exports don't collide.
export function exportFileStem(label: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const body = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${body || 'retro'}-${stamp}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadBoardFile(file: BoardFile): void {
  const blob = new Blob([serializeBoardFile(file)], { type: 'application/json' });
  downloadBlob(blob, exportFileStem(file.board.label) + BOARD_FILE_EXTENSION);
}

export interface ArchiveLike {
  label: string;
  cards: Partial<Record<ColumnKey, CardData[]>>;
  names?: Record<string, string>;
  anonymous?: boolean;
  phase?: string;
  autoSort?: boolean;
  endedAt: number;
}

// Archives saved before the anonymous flag was recorded can't prove they
// weren't anonymous, so they export without names.
export function boardFileFromArchive(archive: ArchiveLike, now = Date.now()): BoardFile {
  return exportBoardFile(
    {
      label: archive.label,
      anonymous: archive.anonymous ?? true,
      phase: isPhase(archive.phase) ? archive.phase : 'brainstorm',
      autoSort: archive.autoSort ?? true,
      cards: {
        wentWell: archive.cards.wentWell ?? [],
        toImprove: archive.cards.toImprove ?? [],
        actions: archive.cards.actions ?? []
      },
      namesMap: archive.names ?? {}
    },
    now
  );
}

// Import caps. They keep the single import transaction well under the 2 MiB
// WebSocket frame limit (MAX_WS_FRAME_BYTES in src/main.rs) and the pending
// file small enough for sessionStorage.
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_CARDS = 300;
export const MAX_IMPORT_COMMENTS_PER_CARD = 50;

// Every way an import can fail, with the message shown in the preview. The
// keys are also sent to analytics as the failure reason, so treat them as
// stable identifiers.
export const IMPORT_ERRORS = {
  too_large: 'This file is too large to import (over 1 MB).',
  read_failed: "Couldn't read that file.",
  invalid_json: "This file isn't valid JSON.",
  not_export: "This isn't a fast-retro export. Use a .fastretro.json file from Export → Save board file.",
  bad_version: "This file's version is missing or invalid.",
  newer_version: 'This file was exported by a newer version of fast-retro.',
  too_many_cards: `This board has more than ${MAX_IMPORT_CARDS} cards, which is more than import supports.`,
  too_many_comments: `A card has more than ${MAX_IMPORT_COMMENTS_PER_CARD} comments, which is more than import supports.`
} as const;

export type ImportErrorCode = keyof typeof IMPORT_ERRORS;

export interface ImportError {
  ok: false;
  code: ImportErrorCode;
  error: string;
}

export function importError(code: ImportErrorCode): ImportError {
  return { ok: false, code, error: IMPORT_ERRORS[code] };
}
const MAX_LABEL_LEN = 60;
const MAX_NAME_LEN = 40;
const MAX_ID_LEN = 64;

export interface BoardFileStats {
  cards: number;
  comments: number;
  votes: number;
  reactions: number;
  namesRestored: boolean;
}

export interface ParseSuccess {
  ok: true;
  file: BoardFile;
  warnings: string[];
  stats: BoardFileStats;
}

export type ParseResult = ParseSuccess | ImportError;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUserId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN;
}

function userIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isUserId))];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function boardFileStats(file: BoardFile): BoardFileStats {
  const stats = { cards: 0, comments: 0, votes: 0, reactions: 0, namesRestored: !!file.names };
  for (const col of COLUMNS) {
    for (const card of file.cards[col.key]) {
      stats.cards++;
      stats.comments += card.comments.length;
      stats.votes += card.votes.length;
      for (const users of Object.values(card.reactions)) stats.reactions += users.length;
    }
  }
  return stats;
}

// Validates an untrusted file and normalizes it to exactly the shape
// exportBoardFile produces: unknown keys dropped, missing collections empty,
// malformed cards and comments skipped with a warning.
export function parseBoardFile(text: string): ParseResult {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return importError('too_large');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return importError('invalid_json');
  }
  if (!isRecord(raw) || raw.format !== BOARD_FILE_FORMAT) {
    return importError('not_export');
  }
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return importError('bad_version');
  }
  if (version > BOARD_FILE_VERSION) {
    return importError('newer_version');
  }

  const warnings: string[] = [];
  const exportedAt = typeof raw.exportedAt === 'number' ? raw.exportedAt : 0;
  const rawBoard = isRecord(raw.board) ? raw.board : {};
  const label = typeof rawBoard.label === 'string' ? rawBoard.label.trim().slice(0, MAX_LABEL_LEN) : '';
  const anonymous = rawBoard.anonymous === true;
  let phase: Phase = 'brainstorm';
  if (isPhase(rawBoard.phase)) phase = rawBoard.phase;
  else if (rawBoard.phase !== undefined) warnings.push('Unknown phase; the board will start in Brainstorm.');
  const autoSort = rawBoard.autoSort !== false;

  const rawCards = isRecord(raw.cards) ? raw.cards : {};
  const cards = { wentWell: [], toImprove: [], actions: [] } as Record<ColumnKey, CardData[]>;
  let skippedCards = 0;
  let skippedComments = 0;
  let total = 0;
  for (const col of COLUMNS) {
    const list = rawCards[col.key];
    if (!Array.isArray(list)) continue;
    for (const rc of list) {
      if (!isRecord(rc) || typeof rc.text !== 'string') {
        skippedCards++;
        continue;
      }
      if (++total > MAX_IMPORT_CARDS) {
        return importError('too_many_cards');
      }
      const reactions: Record<string, string[]> = {};
      if (isRecord(rc.reactions)) {
        for (const [emoji, users] of Object.entries(rc.reactions)) {
          const ids = userIds(users);
          if (emoji && emoji.length <= MAX_ID_LEN && ids.length) reactions[emoji] = ids;
        }
      }
      const comments: CommentData[] = [];
      if (Array.isArray(rc.comments)) {
        if (rc.comments.length > MAX_IMPORT_COMMENTS_PER_CARD) {
          return importError('too_many_comments');
        }
        for (const cm of rc.comments) {
          if (!isRecord(cm) || typeof cm.text !== 'string') {
            skippedComments++;
            continue;
          }
          comments.push({
            id: typeof cm.id === 'string' ? cm.id : '',
            text: cm.text,
            authorId: isUserId(cm.authorId) ? cm.authorId : '',
            createdAt: typeof cm.createdAt === 'number' ? cm.createdAt : exportedAt
          });
        }
      }
      cards[col.key].push({
        id: typeof rc.id === 'string' ? rc.id : '',
        text: rc.text,
        authorId: isUserId(rc.authorId) ? rc.authorId : '',
        votes: userIds(rc.votes),
        reactions,
        comments
      });
    }
  }
  if (skippedCards) warnings.push(`Skipped ${plural(skippedCards, 'card')} with no text.`);
  if (skippedComments) warnings.push(`Skipped ${plural(skippedComments, 'comment')} with no text.`);

  const file: BoardFile = {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    exportedAt,
    board: { label, anonymous, phase, autoSort },
    cards
  };
  // A hand-edited anonymous file can't smuggle names in.
  if (!anonymous && isRecord(raw.names)) {
    const referenced = referencedUserIds(cards);
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(raw.names)) {
      if (!referenced.has(id) || typeof name !== 'string') continue;
      const t = name.trim().slice(0, MAX_NAME_LEN);
      if (t) names[id] = t;
    }
    file.names = names;
  }
  return { ok: true, file, warnings, stats: boardFileStats(file) };
}

export function describeStats(stats: BoardFileStats, anonymous: boolean): string {
  const parts = [
    plural(stats.cards, 'card'),
    plural(stats.comments, 'comment'),
    plural(stats.votes, 'vote'),
    plural(stats.reactions, 'reaction')
  ];
  parts.push(anonymous ? 'anonymous' : stats.namesRestored ? 'names restored' : 'no names');
  return parts.join(' · ');
}
