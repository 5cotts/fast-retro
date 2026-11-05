import type { CardData } from './types';
import { DEFAULT_COLUMNS, type ColumnDef } from './columns';
import { clusterDisplayName, layoutBoard, type ClusterDef } from './clusters';

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

export function exportCSV(
  boardSnapshot: Record<string, CardData[]>,
  columns: ColumnDef[] = DEFAULT_COLUMNS,
  clusters: ClusterDef[] = []
): string {
  // `group` stays last so existing spreadsheet formulas keep working. It uses
  // the same rules as the board, so it matches what people see.
  const groupOf = new Map<string, string>();
  const { lanes } = layoutBoard(columns, boardSnapshot, clusters, { showClusters: true, sortByVotes: false });
  for (const lane of lanes) {
    for (const list of Object.values(lane.cards)) {
      for (const card of list) groupOf.set(card.id, clusterDisplayName(lane.cluster));
    }
  }
  const rows: string[][] = [['column', 'card_text', 'votes', 'reactions', 'comments', 'group']];
  for (const col of columns) {
    for (const card of boardSnapshot[col.key] ?? []) {
      const reactionStr = Object.entries(card.reactions)
        .filter(([, users]) => users.length > 0)
        .map(([emoji, users]) => `${emoji}:${users.length}`)
        .join(' ');
      const commentsStr = card.comments
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((c) => c.text)
        .join(' | ');
      rows.push([col.title, card.text, String(card.votes.length), reactionStr, commentsStr, groupOf.get(card.id) ?? '']);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
