import type { WebsocketProvider } from 'y-websocket';
import type { PresenceUser } from './types';

export interface AwarenessUser {
  name?: string;
  color?: string;
  isLead?: boolean;
  typing?: string | null;
  presenting?: boolean;
}

/**
 * Merge a partial patch into the local awareness "user" field, preserving
 * other keys. Replaces the three hand-rolled `setLocalStateField('user', ...)`
 * sites in Board.svelte.
 */
export function updateAwarenessUser(provider: WebsocketProvider, patch: AwarenessUser): void {
  const aw = provider.awareness;
  const cur = aw.getLocalState() as { user?: AwarenessUser } | null;
  const user = cur?.user ?? {};
  aw.setLocalStateField('user', { ...user, ...patch });
}

// Awareness changes on every frame of a card drag. Keeping the old array when
// nobody's name, role or typing changed stops that traffic reaching the board.
export function samePresence(a: readonly PresenceUser[], b: readonly PresenceUser[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return (
      p.clientId === q.clientId &&
      p.name === q.name &&
      p.color === q.color &&
      p.isLead === q.isLead &&
      !!p.presenting === !!q.presenting &&
      (p.typing ?? null) === (q.typing ?? null)
    );
  });
}
