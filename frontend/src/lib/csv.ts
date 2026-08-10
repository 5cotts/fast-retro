import type { CardData, ColumnKey } from './types';
import { COLUMNS } from './types';

// Neutralize CSV/formula injection: a cell starting with =, +, -, @, tab, or
// CR is interpreted as a formula by Excel/Sheets when the file is opened.
// Card text and comments are unauthenticated free-text from any participant,
// so this has to be enforced here rather than trusted from the source.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(v: string): string {
  const safe = FORMULA_PREFIX.test(v) ? `'${v}` : v;
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
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
