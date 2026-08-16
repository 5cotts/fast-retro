import * as Y from 'yjs';

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
  group: 'Lead can drag a card onto another to merge duplicates.',
  vote: 'Vote on what to discuss.',
  discuss: 'Talk through the top votes.',
  actions: 'Decide what to do next.'
};

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

export function nextPhase(current: Phase): Phase {
  const idx = PHASES.indexOf(current);
  if (idx < 0 || idx >= PHASES.length - 1) return current;
  return PHASES[idx + 1];
}

export function prevPhase(current: Phase): Phase {
  const idx = PHASES.indexOf(current);
  if (idx <= 0) return current;
  return PHASES[idx - 1];
}

// Per-phase action gating. The phase strip is more than an indicator — it
// enforces the canonical retro flow so that participants don't, e.g., add
// late cards in the middle of voting.
//
// Reactions, comments, edits, and drag-to-reorder remain available in every
// phase: they're either conversational (low stakes) or remediation of
// honest mistakes. Only "structural" actions are gated.
export function canAddCardInColumn(column: string, phase: Phase): boolean {
  // Inputs (went-well, to-improve) are captured during Brainstorm.
  // Action items are captured during the final Actions phase.
  if (column === 'wentWell' || column === 'toImprove') return phase === 'brainstorm';
  if (column === 'actions') return phase === 'actions';
  return true;
}

export function canVoteInPhase(phase: Phase): boolean {
  return phase === 'vote';
}

// Once vote counts start driving display order (vote phase onward), manual
// drag-to-reorder would just get overridden by the next sort on re-render.
// Disable the reposition affordance for those phases rather than let drags
// silently no-op. Group-phase merge-by-drag is a different gesture and stays
// available.
export function canReorderCards(phase: Phase): boolean {
  return phase === 'brainstorm' || phase === 'group';
}
