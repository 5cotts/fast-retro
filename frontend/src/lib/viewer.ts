// Who the screen is drawn for. Actions always use the real user id; a viewer
// only decides what's marked as yours. While presenting, nothing is, so the
// board looks the way it does to anyone else.
export type Viewer = { kind: 'self'; id: string } | { kind: 'presenting' };

export function selfViewer(id: string): Viewer {
  return { kind: 'self', id };
}

export function viewerFor(id: string, presenting: boolean): Viewer {
  return presenting ? { kind: 'presenting' } : selfViewer(id);
}

export function isPresenting(viewer: Viewer): boolean {
  return viewer.kind === 'presenting';
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

// Presenting lives only in the tab's URL, as a bare `?present`: per tab,
// survives a reload, and a link to it opens a presenting window. Nothing is
// written to storage, the board or the server.
const PRESENT_PARAM = 'present';

export function isPresentingUrl(url: URL): boolean {
  return url.searchParams.has(PRESENT_PARAM);
}

export function withPresenting(url: URL, on: boolean): URL {
  const next = new URL(url);
  const params = new URLSearchParams(next.search);
  params.delete(PRESENT_PARAM);
  const rest = params.toString();
  next.search = on ? (rest ? `${rest}&${PRESENT_PARAM}` : PRESENT_PARAM) : rest;
  return next;
}
