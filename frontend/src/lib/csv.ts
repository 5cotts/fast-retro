import type { CardData, ColumnKey } from './types';
import { COLUMNS } from './types';

export function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
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
