// Thin client for the fast-retro backend API (accounts + board lifecycle).
// All calls include credentials so the session cookie rides along.

import { getHostKey } from './boards';

export interface MeUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export interface AppConfig {
  googleEnabled: boolean;
  googleClientId: string;
}

export interface BoardStatus {
  slug: string;
  exists: boolean;
  ended: boolean;
  label: string;
  amHost: boolean;
}

export interface MyBoard {
  slug: string;
  label: string;
  ended: boolean;
  createdAt: number;
  isOwner: boolean;
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
}

export async function fetchConfig(): Promise<AppConfig> {
  try {
    return await jsonOrThrow<AppConfig>(await fetch('/api/config'));
  } catch {
    return { googleEnabled: false, googleClientId: '' };
  }
}

export async function fetchMe(): Promise<MeUser | null> {
  try {
    const d = await jsonOrThrow<{ user: MeUser | null }>(
      await fetch('/api/me', { credentials: 'same-origin' })
    );
    return d.user;
  } catch {
    return null;
  }
}

export async function signInWithGoogle(credential: string): Promise<MeUser | null> {
  const d = await jsonOrThrow<{ user: MeUser }>(
    await fetch('/api/auth/google', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential })
    })
  );
  return d.user;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
}

// Create a board; returns { slug, hostKey }. Retries once on a slug collision
// with a caller-supplied fresh slug.
export async function createBoard(slug: string, label: string): Promise<{ slug: string; hostKey: string }> {
  const r = await fetch('/api/boards', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug, label })
  });
  return jsonOrThrow<{ slug: string; hostKey: string }>(r);
}

export async function fetchBoardStatus(slug: string): Promise<BoardStatus | null> {
  const key = getHostKey(slug);
  try {
    return await jsonOrThrow<BoardStatus>(
      await fetch(`/api/boards/${encodeURIComponent(slug)}`, {
        credentials: 'same-origin',
        headers: key ? { 'x-host-key': key } : {}
      })
    );
  } catch {
    return null;
  }
}

// End (archive + freeze) a board. Auth via the board host key, the global lead
// token (admin), or the session cookie (owner).
export async function endBoard(
  slug: string,
  body: { label: string; cards: unknown; names: unknown },
  auth: { hostKey?: string; leadToken?: string }
): Promise<{ archiveId: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.hostKey) headers['x-host-key'] = auth.hostKey;
  else if (auth.leadToken) headers['authorization'] = `Bearer ${auth.leadToken}`;
  const r = await fetch(`/api/boards/${encodeURIComponent(slug)}/end`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(body)
  });
  return jsonOrThrow<{ archiveId: string }>(r);
}

export async function fetchMyBoards(): Promise<MyBoard[]> {
  try {
    return await jsonOrThrow<MyBoard[]>(
      await fetch('/api/me/boards', { credentials: 'same-origin' })
    );
  } catch {
    return [];
  }
}
