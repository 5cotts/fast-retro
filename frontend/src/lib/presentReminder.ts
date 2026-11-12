import { isSamePerson } from './identity';
import type { PresenceUser } from './types';

// The reminder to present (docs/presenter-mode-plan.md, *The reminder*). A
// browser can't tell when Zoom is sharing it, so people arriving on the board
// stands in for "the call has started". Every rule for when it shows lives
// here, so each one is a unit test rather than an {#if} in a component.

export interface ReminderInputs {
  isLead: boolean;
  ended: boolean;
  presenting: boolean;
  // On narrow screens Present is in the mobile menu, so there's nothing to
  // anchor the callout to, and nobody screen-shares a retro from a phone.
  narrow: boolean;
  othersHere: boolean;
  // Dismissed, or presented once, on this board.
  dismissedHere: boolean;
  // "Don't remind me", for this browser.
  remindersOff: boolean;
}

export function shouldRemind(i: ReminderInputs): boolean {
  return i.isLead && !i.ended && !i.presenting && !i.narrow && i.othersHere && !i.dismissedHere && !i.remindersOff;
}

/**
 * Whether anyone other than this browser's user is on the board. The host's
 * own other tabs and windows (same name and color) don't count, and neither
 * does this client before it shows up in presence.
 */
export function someoneElseHere(presence: readonly PresenceUser[], selfClientId: number): boolean {
  const self = presence.find((p) => p.clientId === selfClientId);
  if (!self) return false;
  return presence.some((p) => p.clientId !== selfClientId && !isSamePerson(p, self));
}
