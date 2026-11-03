import type { CardData, CommentData } from './types';
import { DEFAULT_COLUMNS, sameColumns, sanitizeColumns, type ColumnDef } from './columns';
import { PHASES, clampPhase, phasesFor, type Phase } from './phase';

// Round-trippable board export. `cards` deliberately matches the archive
// snapshot shape (`BoardCardsSnapshot` in src/archive.rs) so archives and live
// boards export through the same code.
//
// Versioning rule: bump the version only when an older reader would silently
// lose data. Version 2 adds `board.columns` for custom columns, which a v1
// reader would drop along with their cards, so only boards with custom
// columns are written as v2 (and v1 readers refuse them). Classic boards are
// still written as v1, readable by every build. Optional, ignorable fields
// don't bump the version.
export const BOARD_FILE_FORMAT = 'fast-retro';
export const BOARD_FILE_VERSION = 2;
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
    // Written only when on. Optional and ignorable, so no version bump.
    hideCards?: boolean;
    // Absent for classic boards (the three default columns). See
    // boardFileColumns.
    columns?: ColumnDef[];
  };
  names?: Record<string, string>;
  cards: Record<string, CardData[]>;
}

export interface BoardFileSource {
  label: string;
  anonymous: boolean;
  phase: Phase;
  autoSort: boolean;
  hideCards?: boolean;
  // Only these columns' cards are exported. Defaults to the classic three;
  // a custom board must pass its own list or its cards are left out.
  columns?: ColumnDef[];
  cards: Record<string, CardData[]>;
  namesMap: Record<string, string>;
}

export function boardFileColumns(file: BoardFile): ColumnDef[] {
  return file.board.columns ?? DEFAULT_COLUMNS;
}

export function isPhase(v: unknown): v is Phase {
  return typeof v === 'string' && (PHASES as readonly string[]).includes(v);
}

function referencedUserIds(cards: Record<string, CardData[]>): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(cards)) {
    for (const card of list) {
      if (card.authorId) ids.add(card.authorId);
      for (const v of card.votes) ids.add(v);
      for (const users of Object.values(card.reactions)) for (const u of users) ids.add(u);
      for (const c of card.comments) if (c.authorId) ids.add(c.authorId);
    }
  }
  return ids;
}

// Copies only the given columns, in order, so stray arrays in the doc never
// reach a file.
function copyCards(cards: Record<string, CardData[]>, columns: ColumnDef[]): Record<string, CardData[]> {
  const out: Record<string, CardData[]> = {};
  for (const col of columns) {
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
  const columns = src.columns ?? DEFAULT_COLUMNS;
  const custom = !sameColumns(columns, DEFAULT_COLUMNS);
  const cards = copyCards(src.cards, columns);
  const file: BoardFile = {
    format: BOARD_FILE_FORMAT,
    version: custom ? 2 : 1,
    exportedAt: now,
    board: {
      label: src.label,
      anonymous: src.anonymous,
      phase: src.phase,
      autoSort: src.autoSort,
      ...(src.hideCards ? { hideCards: true } : {}),
      ...(custom ? { columns: columns.map((c) => ({ ...c })) } : {})
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

// The seed for a blank new board: no cards, Brainstorm, auto-sort on.
export function newBoardSeed(
  opts: { label: string; anonymous: boolean; hideCards?: boolean; columns?: ColumnDef[] },
  now = Date.now()
): BoardFile {
  return exportBoardFile(
    {
      label: opts.label,
      anonymous: opts.anonymous,
      phase: 'brainstorm',
      autoSort: true,
      hideCards: opts.hideCards,
      columns: opts.columns ?? DEFAULT_COLUMNS,
      cards: {},
      namesMap: {}
    },
    now
  );
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
  cards: Partial<Record<string, CardData[]>>;
  names?: Record<string, string>;
  anonymous?: boolean;
  phase?: string;
  autoSort?: boolean;
  hideCards?: boolean;
  columns?: unknown;
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
      hideCards: archive.hideCards === true,
      columns: sanitizeColumns(archive.columns) ?? DEFAULT_COLUMNS,
      cards: Object.fromEntries(
        Object.entries(archive.cards).map(([key, list]) => [key, list ?? []])
      ),
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
  for (const list of Object.values(file.cards)) {
    for (const card of list) {
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
  const hideCards = rawBoard.hideCards === true;
  let columns = DEFAULT_COLUMNS;
  if (rawBoard.columns !== undefined) {
    const clean = sanitizeColumns(rawBoard.columns);
    if (clean) columns = clean;
    else warnings.push("The file's column list is invalid; using the standard retro columns.");
  }
  phase = clampPhase(phase, phasesFor(columns));

  const rawCards = isRecord(raw.cards) ? raw.cards : {};
  const cards: Record<string, CardData[]> = Object.fromEntries(columns.map((c) => [c.key, []]));
  let skippedCards = 0;
  let skippedComments = 0;
  let total = 0;
  const known = new Set(columns.map((c) => c.key));
  let orphanCards = 0;
  for (const [key, list] of Object.entries(rawCards)) {
    if (!known.has(key) && Array.isArray(list)) orphanCards += list.length;
  }
  for (const col of columns) {
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
  if (orphanCards) warnings.push(`Skipped ${plural(orphanCards, 'card')} in columns this file doesn't define.`);
  const custom = !sameColumns(columns, DEFAULT_COLUMNS);

  const file: BoardFile = {
    format: BOARD_FILE_FORMAT,
    version: custom ? 2 : 1,
    exportedAt,
    board: { label, anonymous, phase, autoSort, ...(hideCards ? { hideCards } : {}), ...(custom ? { columns } : {}) },
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
