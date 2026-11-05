import { describe, expect, it } from 'vitest';
import { boardFileColumns, boardFileFromArchive, exportBoardFile, newBoardSeed, parseBoardFile, serializeBoardFile } from './boardfile';
import { DEFAULT_COLUMNS, type ColumnDef } from './columns';
import { exportCSV } from './csv';
import type { CardData } from './types';

const custom: ColumnDef[] = [
  { key: 'c-a', title: 'Problem A', color: 'emerald' },
  { key: 'c-b', title: '=HYPERLINK("http://x")', color: 'amber' },
  { key: 'actions', title: 'Action items', color: 'sky' }
];
const card = (text: string): CardData => ({ id: text, text, authorId: 'u1', votes: [], reactions: {}, comments: [] });
const source = (columns?: ColumnDef[]) => ({
  label: 'L',
  anonymous: false,
  phase: 'brainstorm' as const,
  autoSort: true,
  columns,
  cards: { 'c-a': [card('one')], 'c-b': [card('two')], wentWell: [card('classic')], actions: [], stray: [card('stray')] },
  namesMap: {}
});

describe('board files with custom columns', () => {
  it('writes classic boards as v1 with no column list', () => {
    const file = exportBoardFile(source(DEFAULT_COLUMNS));
    expect(file.version).toBe(1);
    expect(file.board.columns).toBeUndefined();
    expect(Object.keys(file.cards)).toEqual(['wentWell', 'toImprove', 'actions']);
  });

  it('writes custom boards as v2 with only their own columns, in order', () => {
    const file = exportBoardFile(source(custom));
    expect(file.version).toBe(2);
    expect(file.board.columns).toEqual(custom);
    expect(Object.keys(file.cards)).toEqual(['c-a', 'c-b', 'actions']);
    const parsed = parseBoardFile(serializeBoardFile(file));
    expect(parsed.ok && boardFileColumns(parsed.file)).toEqual(custom);
  });

  it('drops cards under keys the file does not define, with a warning', () => {
    const file = JSON.parse(serializeBoardFile(exportBoardFile(source(custom))));
    file.cards.unknown = [card('lost'), card('lost too')];
    const r = parseBoardFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual(["Skipped 2 cards in columns this file doesn't define."]);
    expect(r.stats.cards).toBe(2);
  });

  it('falls back to the classic columns when the list is unusable', () => {
    const file = JSON.parse(serializeBoardFile(exportBoardFile(source(custom))));
    file.board.columns = [{ key: 'bad key' }];
    const r = parseBoardFile(JSON.stringify(file));
    expect(r.ok && r.warnings[0]).toBe("The file's column list is invalid; using the standard retro columns.");
    expect(r.ok && boardFileColumns(r.file)).toEqual(DEFAULT_COLUMNS);
  });

  it('exports archives with their stored columns', () => {
    const file = boardFileFromArchive({
      label: 'A',
      endedAt: 1,
      anonymous: false,
      columns: custom,
      cards: { 'c-a': [card('one')], actions: [] }
    });
    expect(file.board.columns).toEqual(custom);
    expect(file.cards['c-a'].map((c) => c.text)).toEqual(['one']);
    expect(file.cards['c-b']).toEqual([]);
  });

  it('round-trips a board without Action items, landing an Actions phase on Discuss', () => {
    const noActions = custom.slice(0, 2);
    const file = exportBoardFile({ ...source(noActions), phase: 'actions' });
    expect(file.board.columns).toEqual(noActions);
    expect(file.cards.actions).toBeUndefined();
    const r = parseBoardFile(serializeBoardFile(file));
    expect(r.ok && boardFileColumns(r.file)).toEqual(noActions);
    expect(r.ok && r.file.board.phase).toBe('discuss');
  });

  it('builds a blank custom seed', () => {
    const seed = newBoardSeed({ label: 'B', anonymous: true, columns: custom });
    expect(boardFileColumns(seed)).toEqual(custom);
    expect(Object.values(seed.cards).flat()).toEqual([]);
  });
});

describe('CSV with custom columns', () => {
  it('uses the column titles and neutralizes formula-like titles', () => {
    const csv = exportCSV(source(custom).cards, custom);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('Problem A,one,0,,,');
    expect(lines[2]).toBe(`"'=HYPERLINK(""http://x"")",two,0,,,`);
    expect(csv).not.toContain('stray');
    expect(csv).not.toContain('classic');
  });
});
