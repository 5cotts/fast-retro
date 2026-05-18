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
  group: 'Drag related cards together.',
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

// NOTE: Per-phase gating (e.g. hiding voting controls during Brainstorm) is
// intentionally not implemented yet. Today the phase is purely a shared
// indicator + lead-driven step counter — every action is still available in
// every phase. TODO: gate vote / reaction visibility per phase when the team
// decides on the exact behaviour.
