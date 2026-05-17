/**
 * Typed accessors for the localStorage keys used by the app.
 *
 * Keys owned here:
 *   - retro-user-id : the stable per-browser user id
 *   - retro-name    : the user's chosen display name
 *   - retro-theme   : 'auto' | 'light' | 'dark'
 *
 * Legacy key:
 *   - retro-dark    : '0' | '1' (replaced by retro-theme in 2026-05). One-shot
 *                     migration on first read; removed once migrated. Remove
 *                     this migration branch after 2026-09.
 */

const KEY_USER_ID = 'retro-user-id';
const KEY_NAME = 'retro-name';
const KEY_THEME = 'retro-theme';
const KEY_LEGACY_DARK = 'retro-dark';

export type ThemePref = 'auto' | 'light' | 'dark';

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function getUserId(): string {
  let id = localStorage.getItem(KEY_USER_ID);
  if (!id) {
    id = newId();
    localStorage.setItem(KEY_USER_ID, id);
  }
  return id;
}

export function getName(): string | null {
  const v = localStorage.getItem(KEY_NAME);
  return v && v.trim() ? v.trim() : null;
}

export function setName(name: string): void {
  localStorage.setItem(KEY_NAME, name);
}

export function getTheme(): ThemePref {
  const v = localStorage.getItem(KEY_THEME);
  if (v === 'light' || v === 'dark' || v === 'auto') return v;

  // Legacy migration: retro-dark → retro-theme.
  const legacy = localStorage.getItem(KEY_LEGACY_DARK);
  if (legacy === '1' || legacy === '0') {
    const migrated: ThemePref = legacy === '1' ? 'dark' : 'light';
    localStorage.setItem(KEY_THEME, migrated);
    localStorage.removeItem(KEY_LEGACY_DARK);
    return migrated;
  }
  return 'auto';
}

export function setTheme(pref: ThemePref): void {
  localStorage.setItem(KEY_THEME, pref);
}
