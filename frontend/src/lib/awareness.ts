import type { WebsocketProvider } from 'y-websocket';

export interface AwarenessUser {
  name?: string;
  color?: string;
  isLead?: boolean;
  typing?: string | null;
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
