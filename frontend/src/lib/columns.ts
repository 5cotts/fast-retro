import type * as Y from 'yjs';
import { newId } from './identity';

// A board's columns are data, not code: an ordered list stored in the board's
// meta map. Boards that never stored one are classic retros and resolve to
// DEFAULT_COLUMNS, so old boards, archives and v1 board files need no
// migration.

export type ColumnColor = 'emerald' | 'amber' | 'sky' | 'violet' | 'rose' | 'teal' | 'orange';

export interface ColumnDef {
  key: string;
  title: string;
  color: ColumnColor;
}

// The Action items column always exists, is always last and always has this
// key. isActionsColumn is the one place that knows how to recognize it.
export const ACTIONS_COLUMN_KEY = 'actions';
export const isActionsColumn = (c: Pick<ColumnDef, 'key'>): boolean => c.key === ACTIONS_COLUMN_KEY;

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'wentWell', title: 'What went well', color: 'emerald' },
  { key: 'toImprove', title: 'What to improve', color: 'amber' },
  { key: ACTIONS_COLUMN_KEY, title: 'Action items', color: 'sky' }
];

const ACTIONS_COLUMN = DEFAULT_COLUMNS[2];

export const MAX_COLUMN_TITLE_LEN = 100;
// Not a product limit (hosts can add as many columns as they like). The list
// is written by any connected client, so this only stops a buggy or hostile
// one from freezing everyone's tab with a huge list.
export const MAX_INPUT_COLUMNS = 50;

const COLUMN_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

// Sky is reserved for Action items so it always stands out.
const INPUT_PALETTE: ColumnColor[] = ['emerald', 'amber', 'violet', 'rose', 'teal', 'orange'];
const COLORS = new Set<ColumnColor>([...INPUT_PALETTE, 'sky']);

export function paletteColor(index: number): ColumnColor {
  return INPUT_PALETTE[index % INPUT_PALETTE.length];
}

// Literal class strings, because Tailwind can't see classes built at runtime.
// Dark-mode tints are raised to /55 so columns stay distinct against the
// slate-900 page; the title row gets its own tint so a column keeps its
// identity even when its body is empty.
export const COLUMN_STYLE: Record<ColumnColor, { accent: string; header: string; dot: string }> = {
  emerald: {
    accent: 'border-emerald-300/60 bg-emerald-50/70 dark:bg-emerald-950/55 dark:border-emerald-700/60',
    header: 'bg-emerald-100/70 dark:bg-emerald-900/45',
    dot: 'bg-emerald-400 dark:bg-emerald-400'
  },
  amber: {
    accent: 'border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/55 dark:border-amber-700/60',
    header: 'bg-amber-100/70 dark:bg-amber-900/45',
    dot: 'bg-amber-400 dark:bg-amber-400'
  },
  sky: {
    accent: 'border-sky-300/60 bg-sky-50/70 dark:bg-sky-950/55 dark:border-sky-700/60',
    header: 'bg-sky-100/70 dark:bg-sky-900/45',
    dot: 'bg-sky-400 dark:bg-sky-400'
  },
  violet: {
    accent: 'border-violet-300/60 bg-violet-50/70 dark:bg-violet-950/55 dark:border-violet-700/60',
    header: 'bg-violet-100/70 dark:bg-violet-900/45',
    dot: 'bg-violet-400 dark:bg-violet-400'
  },
  rose: {
    accent: 'border-rose-300/60 bg-rose-50/70 dark:bg-rose-950/55 dark:border-rose-700/60',
    header: 'bg-rose-100/70 dark:bg-rose-900/45',
    dot: 'bg-rose-400 dark:bg-rose-400'
  },
  teal: {
    accent: 'border-teal-300/60 bg-teal-50/70 dark:bg-teal-950/55 dark:border-teal-700/60',
    header: 'bg-teal-100/70 dark:bg-teal-900/45',
    dot: 'bg-teal-400 dark:bg-teal-400'
  },
  orange: {
    accent: 'border-orange-300/60 bg-orange-50/70 dark:bg-orange-950/55 dark:border-orange-700/60',
    header: 'bg-orange-100/70 dark:bg-orange-900/45',
    dot: 'bg-orange-400 dark:bg-orange-400'
  }
};

const LEGACY_EMPTY_HINT: Record<string, string> = {
  wentWell: 'Nothing here yet — what worked this sprint?',
  toImprove: 'Nothing here yet — what could be smoother?',
  [ACTIONS_COLUMN_KEY]: 'Nothing here yet — what should we tackle next?'
};

export function columnEmptyHint(c: ColumnDef): string {
  return LEGACY_EMPTY_HINT[c.key] ?? 'Nothing here yet — add the first idea.';
}

export const COLUMN_PLACEHOLDER = 'Add a card…';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Cleans an untrusted column list (from the shared doc or an imported file)
// instead of rejecting it: rejecting the whole list would hide every card on
// the board because of one bad entry. Returns null only when no input column
// survives, so callers can fall back to DEFAULT_COLUMNS.
export function sanitizeColumns(raw: unknown): ColumnDef[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const inputs: ColumnDef[] = [];
  let actions: ColumnDef | null = null;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { key, title, color } = entry;
    if (typeof key !== 'string' || !COLUMN_KEY_RE.test(key) || seen.has(key)) continue;
    if (typeof title !== 'string') continue;
    const t = title.trim().slice(0, MAX_COLUMN_TITLE_LEN);
    if (!t) continue;
    seen.add(key);
    if (key === ACTIONS_COLUMN_KEY) {
      actions = { key, title: t, color: 'sky' };
      continue;
    }
    if (inputs.length >= MAX_INPUT_COLUMNS) continue;
    const c = typeof color === 'string' && COLORS.has(color as ColumnColor) ? (color as ColumnColor) : paletteColor(inputs.length);
    inputs.push({ key, title: t, color: c });
  }
  if (inputs.length === 0) return null;
  return [...inputs, actions ?? { ...ACTIONS_COLUMN }];
}

export function readColumns(meta: Y.Map<unknown>): ColumnDef[] {
  return sanitizeColumns(meta.get('columns')) ?? DEFAULT_COLUMNS;
}

// Fresh columns for a custom board. Keys are random and stable, never derived
// from titles, so renaming a column later never moves its cards.
export function newCustomColumns(titles: string[]): ColumnDef[] {
  const inputs = titles
    .map((t) => t.trim().slice(0, MAX_COLUMN_TITLE_LEN))
    .filter(Boolean)
    .slice(0, MAX_INPUT_COLUMNS)
    .map((title, i) => ({ key: `c-${newId().slice(0, 8)}`, title, color: paletteColor(i) }));
  return sanitizeColumns([...inputs, ACTIONS_COLUMN]) ?? DEFAULT_COLUMNS;
}

export function sameColumns(a: ColumnDef[], b: ColumnDef[]): boolean {
  return a.length === b.length && a.every((c, i) => c.key === b[i].key && c.title === b[i].title && c.color === b[i].color);
}
