// Who the screen is drawn for. Actions always use the real user id; a viewer
// only decides what's marked as yours. While presenting, nothing is, so the
// board looks the way it does to anyone else.
export type Viewer = { kind: 'self'; id: string } | { kind: 'presenting' };

export function selfViewer(id: string): Viewer {
  return { kind: 'self', id };
}

export function viewerId(viewer: Viewer): string | null {
  return viewer.kind === 'self' ? viewer.id : null;
}

export function isMine(viewer: Viewer, authorId: string): boolean {
  return !!authorId && viewerId(viewer) === authorId;
}

export function includesMine(viewer: Viewer, userIds: readonly string[]): boolean {
  const id = viewerId(viewer);
  return !!id && userIds.includes(id);
}
