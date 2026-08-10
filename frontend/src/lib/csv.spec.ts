import { describe, expect, it } from 'vitest';
import { csvCell, exportCSV } from './csv';
import type { CardData, ColumnKey } from './types';

describe('csvCell', () => {
  it('neutralizes formula-injection prefixes with a leading quote', () => {
    // Contains a literal `"`, so it's also CSV-quoted (doubling the inner quotes).
    expect(csvCell('=HYPERLINK("http://evil.example")')).toBe(
      '"\'=HYPERLINK(""http://evil.example"")"'
    );
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\ttabbed')).toBe("'\ttabbed");
    expect(csvCell('\rcarriage')).toBe("'\rcarriage");
  });

  it('leaves normal text untouched', () => {
    expect(csvCell('normal text')).toBe('normal text');
    expect(csvCell('50% done')).toBe('50% done');
    expect(csvCell('')).toBe('');
  });

  it('still quotes commas, quotes, and newlines per standard CSV escaping', () => {
    expect(csvCell('has, a comma')).toBe('"has, a comma"');
    expect(csvCell('has "quotes"')).toBe('"has ""quotes"""');
    expect(csvCell('multi\nline')).toBe('"multi\nline"');
  });

  it('quotes a neutralized formula cell that also contains a comma', () => {
    // The leading quote must survive standard CSV quoting, not get stripped.
    expect(csvCell('=A1,B1')).toBe("\"'=A1,B1\"");
  });
});

describe('exportCSV', () => {
  function card(text: string, overrides: Partial<CardData> = {}): CardData {
    return {
      id: 'c1',
      text,
      authorId: 'u1',
      votes: [],
      reactions: {},
      comments: [],
      ...overrides
    };
  }

  it('neutralizes formula injection in card text end-to-end', () => {
    const snapshot: Record<ColumnKey, CardData[]> = {
      wentWell: [card('=cmd|"/c calc"!A1')],
      toImprove: [],
      actions: []
    };
    const csv = exportCSV(snapshot);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain("'=cmd");
    expect(dataRow).not.toMatch(/^"?What went well",=cmd/);
  });

  it('neutralizes formula injection in comment text end-to-end', () => {
    const snapshot: Record<ColumnKey, CardData[]> = {
      wentWell: [
        card('fine card text', {
          comments: [{ id: 'k1', text: '=HYPERLINK("http://evil.example")', authorId: 'u2', createdAt: 1 }]
        })
      ],
      toImprove: [],
      actions: []
    };
    const csv = exportCSV(snapshot);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain("'=HYPERLINK");
  });
});
