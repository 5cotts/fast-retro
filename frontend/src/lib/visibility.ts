import { isActionsColumn, type ColumnDef } from './columns';
import type { Phase } from './phase';
import type { CardData } from './types';
import { isMine, type Viewer } from './viewer';

export interface VisibilityContext {
  hideCards: boolean;
  phase: Phase;
  ended: boolean;
  viewer: Viewer;
}

// While a board hides cards, each person sees only their own cards during
// Brainstorm; moving on to Group reveals everyone's at once. This stops people
// being swayed by others' ideas. It is not secrecy: every browser still
// receives the whole board.
//
// - Action items are never hidden: they're often carried over from the last
//   retro and meant to be reviewed.
// - Ended boards are never hidden, even if they ended during Brainstorm.
// - Visibility depends only on the phase, so going back to Brainstorm hides
//   cards again. The host is hidden from too.
// - A presenting screen has no "own" cards, so it hides the presenter's too:
//   the shared screen shows what everyone else sees.
export function isHidingCards(ctx: Omit<VisibilityContext, 'viewer'>): boolean {
  return ctx.hideCards && ctx.phase === 'brainstorm' && !ctx.ended;
}

export function isCardHidden(card: Pick<CardData, 'authorId'>, column: ColumnDef, ctx: VisibilityContext): boolean {
  return isHidingCards(ctx) && !isActionsColumn(column) && !isMine(ctx.viewer, card.authorId);
}
