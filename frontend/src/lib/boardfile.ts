import type { CardData, ColumnKey } from './types';
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
