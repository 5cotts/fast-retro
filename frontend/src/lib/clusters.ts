import * as Y from 'yjs';
import { isActionsColumn, type ColumnDef } from './columns';
import type { Phase } from './phase';
import type { CardData } from './types';

// Groups of cards across columns. The UI says "group"; the code says "cluster",
// because "group" already means the phase, an ARIA role and a Tailwind class.
//
// A card points at its cluster; a cluster doesn't list its cards. So a card can
// only be in one cluster, and deleting or moving a card needs no cluster cleanup.
// Cluster records are never deleted: removing one could race with someone adding
// a card to it, and an empty record is simply not shown.

export const MAX_CLUSTER_LABEL_LEN = 60;
export const UNNAMED_CLUSTER_LABEL = 'Untitled group';

export interface ClusterDef {
  id: string;
  label: string;
  createdAt: number;
}

export interface ClusterRecord {
  label: string;
  createdAt: number;
}

export type ClusterMap = Y.Map<ClusterRecord>;

export function clusterMapOf(doc: Y.Doc): ClusterMap {
  return doc.getMap<ClusterRecord>('clusters');
}

export function cleanClusterLabel(label: string): string {
  return label.trim().slice(0, MAX_CLUSTER_LABEL_LEN);
}

// Any client can write to the doc, so what's read is validated here.
export function readClusters(clusters: ClusterMap): ClusterDef[] {
  const out: ClusterDef[] = [];
  clusters.forEach((value, id) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    const { label, createdAt } = value as Partial<Record<keyof ClusterRecord, unknown>>;
    out.push({
      id,
      label: typeof label === 'string' ? cleanClusterLabel(label) : '',
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0
    });
  });
  return out;
}

// Groups are hidden in Brainstorm so a label can't hint at hidden cards. An
// ended board never hides anything, even if it ended during Brainstorm.
export function clustersVisible(phase: Phase, ended: boolean): boolean {
  return ended || phase !== 'brainstorm';
}

export function canEditClusters(phase: Phase, ended: boolean): boolean {
  return phase === 'group' && !ended;
}

// Display order only. Ties keep their original position (stable sort), and
// nothing here writes to the doc.
export function sortedByVotes(cards: CardData[]): CardData[] {
  return [...cards].sort((a, b) => b.votes.length - a.votes.length);
}

export interface ClusterActions {
  join: (column: string, cardId: string, clusterId: string) => void;
  create: (column: string, cardId: string, label: string) => void;
  leave: (column: string, cardId: string) => void;
  rename: (clusterId: string, label: string) => void;
  dissolve: (clusterId: string) => void;
}

export interface ClusterLane {
  cluster: ClusterDef;
  // Keyed by column key. Every input column has an entry, possibly empty.
  cards: Record<string, CardData[]>;
  count: number;
  // Different people who voted on any card here. Counting people stops a
  // five-card group outranking a two-card group just for having more cards.
  voters: number;
}

export function clusterDisplayName(cluster: Pick<ClusterDef, 'label'>): string {
  return cluster.label || UNNAMED_CLUSTER_LABEL;
}

export interface BoardLayout {
  lanes: ClusterLane[];
  // Cards outside any lane, keyed by column key, for every column.
  loose: Record<string, CardData[]>;
}

export interface LayoutOptions {
  showClusters: boolean;
  sortByVotes: boolean;
}

function byCreation(a: ClusterDef, b: ClusterDef): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Every rule for what appears where lives here. A cluster with cards shows as a
// lane, except a one-card cluster with no name, which displays as a normal card
// (so dragging out the second-last card needs no write). A named one-card cluster
// stays visible, so other cards have something to join. Action items are the
// output of a retro and are never in a lane, whatever the doc says.
export function layoutBoard(
  columns: ColumnDef[],
  cards: Record<string, CardData[]>,
  clusters: ClusterDef[],
  { showClusters, sortByVotes }: LayoutOptions
): BoardLayout {
  const known = new Map(clusters.map((c) => [c.id, c]));
  const inputColumns = columns.filter((c) => !isActionsColumn(c));
  const members = new Map<string, { column: string; card: CardData }[]>();
  if (showClusters) {
    for (const col of inputColumns) {
      for (const card of cards[col.key] ?? []) {
        if (!card.clusterId || !known.has(card.clusterId)) continue;
        const list = members.get(card.clusterId);
        if (list) list.push({ column: col.key, card });
        else members.set(card.clusterId, [{ column: col.key, card }]);
      }
    }
  }

  const inLane = new Set<string>();
  let lanes: ClusterLane[] = [];
  for (const cluster of [...clusters].sort(byCreation)) {
    const list = members.get(cluster.id);
    if (!list || (list.length === 1 && !cluster.label)) continue;
    const laneCards: Record<string, CardData[]> = {};
    for (const col of inputColumns) laneCards[col.key] = [];
    const voters = new Set<string>();
    for (const { column, card } of list) {
      laneCards[column].push(card);
      inLane.add(card.id);
      for (const v of card.votes) voters.add(v);
    }
    if (sortByVotes) {
      for (const col of inputColumns) laneCards[col.key] = sortedByVotes(laneCards[col.key]);
    }
    lanes.push({ cluster, cards: laneCards, count: list.length, voters: voters.size });
  }
  // Array.sort is stable, so equal lanes stay in creation order.
  if (sortByVotes) lanes = lanes.sort((a, b) => b.voters - a.voters);

  const loose: Record<string, CardData[]> = {};
  for (const col of columns) {
    const rest = (cards[col.key] ?? []).filter((c) => !inLane.has(c.id));
    loose[col.key] = sortByVotes ? sortedByVotes(rest) : rest;
  }
  return { lanes, loose };
}

// The cards a given card moves among with Shift+Up/Down: its lane's cell, or
// the loose area.
export function sectionOf(layout: BoardLayout, columnKey: string, cardId: string): CardData[] {
  for (const lane of layout.lanes) {
    const cell = lane.cards[columnKey];
    if (cell?.some((c) => c.id === cardId)) return cell;
  }
  return layout.loose[columnKey] ?? [];
}

export interface ReorderTarget {
  // Card to insert before, or null for the end of the column.
  beforeId: string | null;
}

// Shift+Up/Down within one section (a lane's cell or the loose area). Returns
// null at the section's edge: leaving a section is a grouping change, not a
// reorder. Sections can be interleaved in the column's array, but only their
// relative order shows, so "before the next card in this section, or the end of
// the column" always lands in the right place.
export function reorderTarget(section: CardData[], cardId: string, delta: -1 | 1): ReorderTarget | null {
  const i = section.findIndex((c) => c.id === cardId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= section.length) return null;
  return { beforeId: delta < 0 ? section[j].id : (section[j + 1]?.id ?? null) };
}
