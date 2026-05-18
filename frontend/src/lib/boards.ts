const KEY_RECENT_BOARDS = 'retro-recent-boards';
const KEY_HOST_TOKEN = 'retro-host-token';
const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const MAX_RECENT = 30;

// Host token is the deployment's RETRO_LEAD_TOKEN, saved per-browser so a
// recurring facilitator doesn't have to retype the lead URL each session.
// It's never broadcast — purely a local convenience.
export function getLeadToken(): string {
  try {
    return localStorage.getItem(KEY_HOST_TOKEN) ?? '';
  } catch {
    return '';
  }
}

export function setLeadToken(token: string): void {
  const t = token.trim();
  if (!t) return;
  try {
    localStorage.setItem(KEY_HOST_TOKEN, t);
  } catch {
    // ignore
  }
}

export function clearLeadToken(): void {
  try {
    localStorage.removeItem(KEY_HOST_TOKEN);
  } catch {
    // ignore
  }
}

export interface RecentBoard {
  slug: string;
  lastVisited: number;
  cardsSeen?: number;
  label?: string;
}

export function newSlug(len = 6): string {
  let s = '';
  const buf = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < len; i++) s += SLUG_ALPHABET[buf[i] % SLUG_ALPHABET.length];
  return s;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidSlug(raw: unknown): raw is string {
  return typeof raw === 'string' && SLUG_RE.test(raw);
}

export function recordRecentBoard(slug: string, extras: Partial<RecentBoard> = {}): void {
  if (!isValidSlug(slug)) return;
  try {
    const list = readRecentBoards();
    const idx = list.findIndex((b) => b.slug === slug);
    const entry: RecentBoard = {
      slug,
      lastVisited: Date.now(),
      ...(idx >= 0 ? list[idx] : {}),
      ...extras
    };
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(entry);
    while (list.length > MAX_RECENT) list.pop();
    localStorage.setItem(KEY_RECENT_BOARDS, JSON.stringify(list));
  } catch {
    // localStorage unavailable; recent-boards is best-effort.
  }
}

export function readRecentBoards(): RecentBoard[] {
  try {
    const raw = localStorage.getItem(KEY_RECENT_BOARDS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b): b is RecentBoard => !!b && isValidSlug(b?.slug) && typeof b?.lastVisited === 'number')
      .sort((a, b) => b.lastVisited - a.lastVisited);
  } catch {
    return [];
  }
}

export function forgetRecentBoard(slug: string): void {
  try {
    const list = readRecentBoards().filter((b) => b.slug !== slug);
    localStorage.setItem(KEY_RECENT_BOARDS, JSON.stringify(list));
  } catch {
    // ignore
  }
}
