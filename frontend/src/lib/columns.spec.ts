import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ACTIONS_COLUMN_KEY,
  DEFAULT_COLUMNS,
  MAX_COLUMN_TITLE_LEN,
  MAX_INPUT_COLUMNS,
  columnEmptyHint,
  isActionsColumn,
  newCustomColumns,
  readColumns,
  sanitizeColumns,
  type ColumnDef
} from './columns';
import { canAddCardInColumn } from './phase';

const col = (key: string, title = key, color = 'emerald') => ({ key, title, color });

describe('sanitizeColumns', () => {
  it('returns null for anything without a usable input column', () => {
    expect(sanitizeColumns(undefined)).toBeNull();
    expect(sanitizeColumns('nope')).toBeNull();
    expect(sanitizeColumns([])).toBeNull();
    expect(sanitizeColumns([col(ACTIONS_COLUMN_KEY, 'Actions')])).toBeNull();
  });

  it('keeps the default columns unchanged', () => {
    expect(sanitizeColumns(DEFAULT_COLUMNS)).toEqual(DEFAULT_COLUMNS);
  });

  it('drops bad keys, empty titles and duplicates instead of rejecting the list', () => {
    const out = sanitizeColumns([
      col('a', 'A'),
      col('bad key!', 'Bad'),
      col('', 'Empty key'),
      col('b', '   '),
      col('a', 'Duplicate'),
      { key: 'c' },
      null,
      col('d', 'D')
    ]);
    expect(out?.map((c) => c.key)).toEqual(['a', 'd', ACTIONS_COLUMN_KEY]);
  });

  it('forces the Action items column to the end, adding it when missing', () => {
    const out = sanitizeColumns([col(ACTIONS_COLUMN_KEY, 'Next steps'), col('a', 'A')]);
    expect(out?.map((c) => c.key)).toEqual(['a', ACTIONS_COLUMN_KEY]);
    expect(out?.[1]).toEqual({ key: ACTIONS_COLUMN_KEY, title: 'Next steps', color: 'sky' });
    const added = sanitizeColumns([col('a', 'A')]);
    expect(added?.[1]).toEqual(DEFAULT_COLUMNS[2]);
  });

  it('trims titles and caps their length', () => {
    const out = sanitizeColumns([col('a', `  ${'x'.repeat(200)}  `)]);
    expect(out?.[0].title).toBe('x'.repeat(MAX_COLUMN_TITLE_LEN));
  });

  it('assigns palette colors when missing or unknown, and keeps sky for actions', () => {
    const out = sanitizeColumns([
      { key: 'a', title: 'A' },
      { key: 'b', title: 'B', color: 'chartreuse' },
      { key: 'c', title: 'C', color: 'rose' }
    ]);
    expect(out?.map((c) => c.color)).toEqual(['emerald', 'amber', 'rose', 'sky']);
  });

  it('caps the number of input columns as a safety limit', () => {
    const many = Array.from({ length: MAX_INPUT_COLUMNS + 10 }, (_, i) => col(`k${i}`, `T${i}`));
    const out = sanitizeColumns(many)!;
    expect(out.length).toBe(MAX_INPUT_COLUMNS + 1);
    expect(isActionsColumn(out[out.length - 1])).toBe(true);
  });
});

describe('readColumns', () => {
  it('falls back to the classic retro columns', () => {
    const meta = new Y.Doc().getMap<unknown>('meta');
    expect(readColumns(meta)).toEqual(DEFAULT_COLUMNS);
    meta.set('columns', [{ key: 'bad key' }]);
    expect(readColumns(meta)).toEqual(DEFAULT_COLUMNS);
  });

  it('reads a stored custom list', () => {
    const meta = new Y.Doc().getMap<unknown>('meta');
    meta.set('columns', [col('p1', 'Problem one'), col(ACTIONS_COLUMN_KEY, 'Action items', 'sky')]);
    expect(readColumns(meta).map((c) => c.title)).toEqual(['Problem one', 'Action items']);
  });
});

describe('newCustomColumns', () => {
  it('makes stable random keys, skips blank titles and ends with Action items', () => {
    const out = newCustomColumns(['One', ' ', 'Two']);
    expect(out.map((c) => c.title)).toEqual(['One', 'Two', 'Action items']);
    expect(out[0].key).toMatch(/^c-[a-z0-9]+$/);
    expect(out[0].key).not.toBe(out[1].key);
  });

  it('falls back to the defaults when every title is blank', () => {
    expect(newCustomColumns(['', '  '])).toEqual(DEFAULT_COLUMNS);
  });
});

describe('column helpers', () => {
  it('opens input columns in Brainstorm and Action items in Actions', () => {
    const custom: ColumnDef = { key: 'c-1', title: 'Problem', color: 'violet' };
    expect(canAddCardInColumn(custom, 'brainstorm')).toBe(true);
    expect(canAddCardInColumn(custom, 'actions')).toBe(false);
    expect(canAddCardInColumn(DEFAULT_COLUMNS[2], 'actions')).toBe(true);
    expect(canAddCardInColumn(DEFAULT_COLUMNS[2], 'brainstorm')).toBe(false);
  });

  it('keeps the legacy empty hints and has a generic one for custom columns', () => {
    expect(columnEmptyHint(DEFAULT_COLUMNS[0])).toBe('Nothing here yet — what worked this sprint?');
    expect(columnEmptyHint({ key: 'c-1', title: 'Problem', color: 'violet' })).toBe('Nothing here yet — add the first idea.');
  });
});
