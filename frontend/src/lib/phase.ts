import * as Y from 'yjs';
import { hasActionsColumn, isActionsColumn, type ColumnDef } from './columns';

export const PHASES = ['brainstorm', 'group', 'vote', 'discuss', 'actions'] as const;
export type Phase = typeof PHASES[number];

export const PHASE_LABEL: Record<Phase, string> = {
  brainstorm: 'Brainstorm',
  group: 'Group',
  vote: 'Vote',
  discuss: 'Discuss',
  actions: 'Actions'
};

export const PHASE_HINT: Record<Phase, string> = {
  brainstorm: 'Add cards in each column.',
  group: 'Drag a card onto another to group them, across columns too. Each card stays in its column.',
  vote: 'Vote on what to discuss.',
  discuss: 'Talk through the top votes.',
  actions: 'Decide what to do next.'
};

const CANVAS_PHASE_HINT: Partial<Record<Phase, string>> = {
  brainstorm: 'Add cards below, or double-click the canvas to place one.',
  group: 'Drag cards near each other to cluster them. Each card keeps its prompt color.'
};

// List view shows a canvas board's cards in columns, where they can't be moved.
const LIST_PHASE_HINT: Partial<Record<Phase, string>> = {
  group: 'Switch to Canvas to arrange the cards.'
};

export function phaseHint(phase: Phase, view: 'columns' | 'canvas' | 'list'): string {
  const special = view === 'canvas' ? CANVAS_PHASE_HINT : view === 'list' ? LIST_PHASE_HINT : {};
  return special[phase] ?? PHASE_HINT[phase];
}

export function readPhase(phaseMap: Y.Map<unknown>): Phase {
  const v = phaseMap.get('current');
  if (typeof v === 'string' && (PHASES as readonly string[]).includes(v)) {
    return v as Phase;
  }
  return 'brainstorm';
}

export function setPhase(phaseMap: Y.Map<unknown>, next: Phase): void {
  phaseMap.set('current', next);
}

// The phases a board walks through. The Actions phase only exists to fill the
// Action items column, so a board without that column ends at Discuss.
export function phasesFor(columns: ColumnDef[]): readonly Phase[] {
  return hasActionsColumn(columns) ? PHASES : PHASES.filter((p) => p !== 'actions');
}

// A stored phase the board doesn't have (only 'actions', on a board without
// Action items) shows as that board's last phase.
export function clampPhase(phase: Phase, phases: readonly Phase[]): Phase {
  return phases.includes(phase) ? phase : phases[phases.length - 1];
}

export function nextPhase(current: Phase, phases: readonly Phase[] = PHASES): Phase {
  const idx = phases.indexOf(current);
  if (idx < 0 || idx >= phases.length - 1) return current;
  return phases[idx + 1];
}

export function prevPhase(current: Phase, phases: readonly Phase[] = PHASES): Phase {
  const idx = phases.indexOf(current);
  if (idx <= 0) return current;
  return phases[idx - 1];
}

// Per-phase action gating. The phase strip is more than an indicator — it
// enforces the canonical retro flow so that participants don't, e.g., add
// late cards in the middle of voting.
//
// Reactions, comments, edits, and drag-to-reorder remain available in every
// phase: they're either conversational (low stakes) or remediation of
// honest mistakes. Only "structural" actions are gated.
export function canAddCardInColumn(column: ColumnDef, phase: Phase): boolean {
  // Input columns are captured during Brainstorm, action items during the
  // final Actions phase.
  return isActionsColumn(column) ? phase === 'actions' : phase === 'brainstorm';
}

export function canVoteInPhase(phase: Phase): boolean {
  return phase === 'vote';
}

// Auto-sort-by-votes only kicks in once the lead moves into Discuss: voting
// itself stays in whatever order the cards were left in after Group, so the
// vote count in front of someone isn't shifting under their cursor while
// they're still casting votes. The sort is display-only (never rewrites the
// underlying Y.Array) and this gate is combined with the board's autoSort
// meta flag by the caller — see Board.svelte's `sortActive`.
export function canSortByVotes(phase: Phase): boolean {
  return phase === 'discuss' || phase === 'actions';
}
