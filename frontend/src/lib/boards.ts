const KEY_RECENT_BOARDS = 'retro-recent-boards';
const KEY_HOST_KEYS = 'retro-host-keys';
const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const MAX_RECENT = 30;

// Per-board host keys. When you create a board you become its host; the server
// returns a capability key that we stash here, keyed by slug. Presenting it
// (via the X-Host-Key header) proves you're the host on this device — no shared
// token, no login required. Signing in additionally ties ownership to your
// account so you're host on any device.
function readHostKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY_HOST_KEYS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getHostKey(slug: string): string {
  return readHostKeys()[slug] ?? '';
}

export function setHostKey(slug: string, key: string): void {
  if (!isValidSlug(slug) || !key) return;
  try {
    const keys = readHostKeys();
    keys[slug] = key;
    localStorage.setItem(KEY_HOST_KEYS, JSON.stringify(keys));
  } catch {
    // best-effort
  }
}

export function clearHostKey(slug: string): void {
  try {
    const keys = readHostKeys();
    delete keys[slug];
    localStorage.setItem(KEY_HOST_KEYS, JSON.stringify(keys));
  } catch {
    // best-effort
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

// Best-effort slug from a human label: lowercase, ascii-fold, collapse
// non-alphanumerics to hyphens, trim, and cap. Returns '' if the result
// wouldn't satisfy isValidSlug — callers fall back to newSlug() in that case.
export function slugifyLabel(label: string, maxLen = 40): string {
  if (!label) return '';
  const normalized = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const slugBody = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return isValidSlug(slugBody) ? slugBody : '';
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

// Stash a label chosen at board-creation time so the board page can apply it
// to the CRDT once the host's connection mounts. Cleared as soon as it's
// consumed so refreshing the board never re-applies a stale name. sessionStorage
// keeps this transient and tab-local.
const PENDING_LABEL_PREFIX = 'retro-pending-label:';

export function setPendingLabel(slug: string, label: string): void {
  if (!isValidSlug(slug) || !label) return;
  try {
    sessionStorage.setItem(PENDING_LABEL_PREFIX + slug, label.slice(0, 60));
  } catch {
    // ignore
  }
}

export function consumePendingLabel(slug: string): string {
  if (!isValidSlug(slug)) return '';
  try {
    const v = sessionStorage.getItem(PENDING_LABEL_PREFIX + slug) ?? '';
    if (v) sessionStorage.removeItem(PENDING_LABEL_PREFIX + slug);
    return v;
  } catch {
    return '';
  }
}

// Marks a slug as "anonymous by default" at board-creation time, mirroring
// the pending-label mechanism above: newly created boards start anonymous,
// but this must not touch the fallback used by every already-open board, so
// the flag is applied once by the board page rather than baked into the CRDT
// default itself.
const PENDING_ANONYMOUS_PREFIX = 'retro-pending-anonymous:';

export function setPendingAnonymous(slug: string): void {
  if (!isValidSlug(slug)) return;
  try {
    sessionStorage.setItem(PENDING_ANONYMOUS_PREFIX + slug, '1');
  } catch {
    // ignore
  }
}

export function consumePendingAnonymous(slug: string): boolean {
  if (!isValidSlug(slug)) return false;
  try {
    const v = sessionStorage.getItem(PENDING_ANONYMOUS_PREFIX + slug);
    if (v) sessionStorage.removeItem(PENDING_ANONYMOUS_PREFIX + slug);
    return v === '1';
  } catch {
    return false;
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
