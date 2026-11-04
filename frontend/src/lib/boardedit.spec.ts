import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { newBoardSeed } from './boardfile';
import {
  ACTIONS_COLUMN_KEY,
  DEFAULT_COLUMNS,
  diffColumns,
  editColumns,
  newCustomColumns,
  readColumns,
  renameColumn,
  type ColumnDef
} from './columns';
import { readPhase, setPhase } from './phase';
import { readBoardSettings } from './settings';
import { addCard, applyBoardEdit, readBoardLabel, readCards, setUpAfterSync } from './yboard';

function freshState() {
  const doc = new Y.Doc();
  return {
    doc,
    board: doc.getMap<Y.Array<Y.Map<unknown>>>('board'),
    meta: doc.getMap<unknown>('meta'),
    names: doc.getMap<string>('names'),
    phase: doc.getMap<unknown>('phase')
  };
}

function boardWith(columns?: ColumnDef[]) {
  const state = freshState();
  setUpAfterSync(state, { file: newBoardSeed({ label: 'Board', anonymous: true, columns }, 1), origin: { kind: 'new' } });
  return state;
}

const rowsOf = (cols: ColumnDef[]) => cols.filter((c) => c.key !== ACTIONS_COLUMN_KEY).map((c) => ({ key: c.key, title: c.title }));

describe('editColumns', () => {
  const current = newCustomColumns(['One', 'Two', 'Three']);

  it('keeps keys and colors when renaming or reordering', () => {
    const [a, b, c] = current;
    const next = editColumns(current, [{ key: c.key, title: 'Third' }, { key: a.key, title: 'One' }, { key: b.key, title: 'Two' }], { actionItems: true })!;
    expect(next.map((x) => x.key)).toEqual([c.key, a.key, b.key, ACTIONS_COLUMN_KEY]);
    expect(next[0]).toEqual({ key: c.key, title: 'Third', color: c.color });
    expect(next[1].color).toBe(a.color);
  });

  it('gives new rows a fresh key and an unused palette color', () => {
    const next = editColumns(current, [...rowsOf(current), { title: 'Four' }], { actionItems: true })!;
    const added = next[3];
    expect(current.some((c) => c.key === added.key)).toBe(false);
    expect(added.key).toMatch(/^c-/);
    expect(current.some((c) => c.color === added.color)).toBe(false);
  });

  it('treats an unknown or repeated key as a new column', () => {
    const [a] = current;
    const next = editColumns(current, [{ key: a.key, title: 'A' }, { key: a.key, title: 'Copy' }, { key: 'nope', title: 'X' }], { actionItems: false })!;
    expect(next).toHaveLength(3);
    expect(new Set(next.map((c) => c.key)).size).toBe(3);
    expect(next[0].key).toBe(a.key);
  });

  it('skips blank rows, and returns null when nothing has a title', () => {
    expect(editColumns(current, [{ key: current[0].key, title: '  ' }, { title: 'New' }], { actionItems: false })!.map((c) => c.title)).toEqual(['New']);
    expect(editColumns(current, [{ title: '' }], { actionItems: true })).toBeNull();
  });

  it('adds or drops Action items, keeping its title', () => {
    const withActions = editColumns(current, rowsOf(current), { actionItems: true })!;
    expect(withActions.at(-1)!.key).toBe(ACTIONS_COLUMN_KEY);
    expect(editColumns(current, rowsOf(current), { actionItems: false })!.some((c) => c.key === ACTIONS_COLUMN_KEY)).toBe(false);
    const renamed = [...current.slice(0, 3), { ...current[3], title: 'Next steps' }];
    expect(editColumns(renamed, rowsOf(renamed), { actionItems: true })!.at(-1)!.title).toBe('Next steps');
  });

  it('returns the classic columns unchanged for a classic board saved as is', () => {
    expect(editColumns(DEFAULT_COLUMNS, rowsOf(DEFAULT_COLUMNS), { actionItems: true })).toEqual(DEFAULT_COLUMNS);
  });
});

describe('diffColumns', () => {
  it('reports added, removed, renamed and reordered', () => {
    const [a, b, c, act] = newCustomColumns(['A', 'B', 'C']);
    const d = { key: 'c-new', title: 'D', color: 'teal' as const };
    const diff = diffColumns([a, b, c, act], [{ ...c, title: 'C2' }, a, d]);
    expect(diff.added.map((x) => x.key)).toEqual(['c-new']);
    expect(diff.removed.map((x) => x.key)).toEqual([b.key, ACTIONS_COLUMN_KEY]);
    expect(diff.renamed).toBe(1);
    expect(diff.reordered).toBe(true);
  });

  it('does not call a removal a reorder', () => {
    const [a, b, c] = newCustomColumns(['A', 'B', 'C'], { actionItems: false });
    expect(diffColumns([a, b, c], [a, c]).reordered).toBe(false);
  });
});

describe('applyBoardEdit', () => {
  it('applies label, settings and columns in one update', () => {
    const state = boardWith();
    let updates = 0;
    state.doc.on('update', () => updates++);
    const next = editColumns(DEFAULT_COLUMNS, [...rowsOf(DEFAULT_COLUMNS), { title: 'Kudos' }], { actionItems: true })!;
    const result = applyBoardEdit(state, { label: 'Renamed', columns: next, settings: { hideCards: true, autoSort: true } });
    expect(updates).toBe(1);
    expect(readBoardLabel(state.meta)).toBe('Renamed');
    expect(readBoardSettings(state.meta).hideCards).toBe(true);
    expect(result.settingsChanged).toBe(1);
    expect(result.added).toHaveLength(1);
    expect(readColumns(state.meta)).toEqual(next);
    expect(state.board.has(next[2].key)).toBe(true);
  });

  it('keeps cards when renaming and reordering', () => {
    const cols = newCustomColumns(['A', 'B']);
    const state = boardWith(cols);
    addCard(state.board, cols[0].key, 'idea', 'u1');
    applyBoardEdit(state, { columns: editColumns(cols, [{ key: cols[1].key, title: 'B' }, { key: cols[0].key, title: 'A renamed' }], { actionItems: true })! });
    expect(readColumns(state.meta)[1].title).toBe('A renamed');
    expect(readCards(state.board, cols[0].key).map((c) => c.text)).toEqual(['idea']);
  });

  it('stores no list when a classic board is edited back to the default columns', () => {
    const state = boardWith();
    const added = editColumns(DEFAULT_COLUMNS, [...rowsOf(DEFAULT_COLUMNS), { title: 'Extra' }], { actionItems: true })!;
    applyBoardEdit(state, { columns: added });
    expect(state.meta.has('columns')).toBe(true);
    applyBoardEdit(state, { columns: DEFAULT_COLUMNS });
    expect(state.meta.has('columns')).toBe(false);
  });

  it('empties a removed column but keeps its array', () => {
    const cols = newCustomColumns(['A', 'B']);
    const state = boardWith(cols);
    addCard(state.board, cols[1].key, 'gone', 'u1');
    const result = applyBoardEdit(state, { columns: editColumns(cols, [{ key: cols[0].key, title: 'A' }], { actionItems: true })! });
    expect(result.removed.map((c) => c.key)).toEqual([cols[1].key]);
    expect(state.board.has(cols[1].key)).toBe(true);
    expect(readCards(state.board, cols[1].key)).toEqual([]);
  });

  it('reuses the existing Action items array when it is turned back on', () => {
    const state = boardWith();
    const actionsArr = state.board.get(ACTIONS_COLUMN_KEY);
    addCard(state.board, ACTIONS_COLUMN_KEY, 'todo', 'u1');
    applyBoardEdit(state, { columns: editColumns(DEFAULT_COLUMNS, rowsOf(DEFAULT_COLUMNS), { actionItems: false })! });
    expect(readCards(state.board, ACTIONS_COLUMN_KEY)).toEqual([]);
    applyBoardEdit(state, { columns: editColumns(readColumns(state.meta), rowsOf(DEFAULT_COLUMNS), { actionItems: true })! });
    expect(state.board.get(ACTIONS_COLUMN_KEY)).toBe(actionsArr);
    expect(state.meta.has('columns')).toBe(false);
  });

  it('moves the board from Actions to Discuss when Action items goes away', () => {
    const state = boardWith();
    setPhase(state.phase, 'actions');
    applyBoardEdit(state, { columns: editColumns(DEFAULT_COLUMNS, rowsOf(DEFAULT_COLUMNS), { actionItems: false })! });
    expect(readPhase(state.phase)).toBe('discuss');
  });

  it('leaves the phase alone otherwise', () => {
    const state = boardWith();
    setPhase(state.phase, 'vote');
    applyBoardEdit(state, { columns: editColumns(DEFAULT_COLUMNS, rowsOf(DEFAULT_COLUMNS), { actionItems: false })! });
    expect(readPhase(state.phase)).toBe('vote');
  });

  it('never leaves a listed column without an array when two hosts edit at once', () => {
    for (const order of ['ab', 'ba'] as const) {
      const cols = newCustomColumns(['A', 'B', 'C']);
      const a = boardWith(cols);
      const b = freshState();
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
      // Host tab A removes B; host tab B, still on the old list, renames C and adds D.
      applyBoardEdit(a, { columns: editColumns(cols, [{ key: cols[0].key, title: 'A' }, { key: cols[2].key, title: 'C' }], { actionItems: true })! });
      applyBoardEdit(b, { columns: editColumns(cols, [...rowsOf(cols).map((r) => (r.key === cols[2].key ? { ...r, title: 'C2' } : r)), { title: 'D' }], { actionItems: true })! });
      const ua = Y.encodeStateAsUpdate(a.doc);
      const ub = Y.encodeStateAsUpdate(b.doc);
      const merged = freshState();
      if (order === 'ab') {
        Y.applyUpdate(merged.doc, ua);
        Y.applyUpdate(merged.doc, ub);
      } else {
        Y.applyUpdate(merged.doc, ub);
        Y.applyUpdate(merged.doc, ua);
      }
      for (const col of readColumns(merged.meta)) expect(merged.board.has(col.key)).toBe(true);
    }
  });

  it('does nothing to columns when none are passed', () => {
    const state = boardWith();
    setPhase(state.phase, 'actions');
    applyBoardEdit(state, { label: 'Only the name' });
    expect(readPhase(state.phase)).toBe('actions');
    expect(state.meta.has('columns')).toBe(false);
  });
});

describe('renameColumn', () => {
  it('renames one column and keeps everything else', () => {
    const cols = newCustomColumns(['A', 'B']);
    const next = renameColumn(cols, cols[1].key, '  B2 ')!;
    expect(next.map((c) => c.title)).toEqual(['A', 'B2', 'Action items']);
    expect(next[1]).toEqual({ ...cols[1], title: 'B2' });
    expect(diffColumns(cols, next)).toEqual({ added: [], removed: [], renamed: 1, reordered: false });
  });

  it('can rename Action items, and caps the title length', () => {
    expect(renameColumn(DEFAULT_COLUMNS, ACTIONS_COLUMN_KEY, 'Next steps')!.at(-1)!.title).toBe('Next steps');
    expect(renameColumn(DEFAULT_COLUMNS, 'wentWell', 'x'.repeat(150))![0].title).toHaveLength(100);
  });

  it('returns null when there is nothing to save', () => {
    expect(renameColumn(DEFAULT_COLUMNS, 'wentWell', '   ')).toBeNull();
    expect(renameColumn(DEFAULT_COLUMNS, 'wentWell', 'What went well')).toBeNull();
    expect(renameColumn(DEFAULT_COLUMNS, 'missing', 'X')).toBeNull();
  });

  it('applies as a rename through applyBoardEdit', () => {
    const state = boardWith();
    addCard(state.board, 'wentWell', 'kept', 'u1');
    const r = applyBoardEdit(state, { columns: renameColumn(readColumns(state.meta), 'wentWell', 'Wins')! });
    expect(r.renamed).toBe(1);
    expect(readColumns(state.meta)[0].title).toBe('Wins');
    expect(readCards(state.board, 'wentWell').map((c) => c.text)).toEqual(['kept']);
  });
});
