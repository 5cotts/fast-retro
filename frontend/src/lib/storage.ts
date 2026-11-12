/**
 * Typed accessors for the localStorage keys used by the app.
 *
 * Keys owned here:
 *   - retro-user-id : the stable per-browser user id
 *   - retro-name    : the user's chosen display name
 *   - retro-theme   : 'auto' | 'light' | 'dark'
 *   - retro-present-reminders : '0' when the host turned off the reminder to
 *                               present; absent means on
 *   - retro-present-dismissed : JSON list of board slugs where the reminder
 *                               was dismissed or the host presented, newest
 *                               first, capped at 50
 *
 * Legacy key:
 *   - retro-dark    : '0' | '1' (replaced by retro-theme in 2026-05). One-shot
 *                     migration on first read; removed once migrated. Remove
 *                     this migration branch after 2026-09.
 */

const KEY_USER_ID = 'retro-user-id';
const KEY_NAME = 'retro-name';
const KEY_THEME = 'retro-theme';
const KEY_ONBOARDED = 'retro-onboarded';
const KEY_LEGACY_DARK = 'retro-dark';
const KEY_PRESENT_REMINDERS = 'retro-present-reminders';
const KEY_PRESENT_DISMISSED = 'retro-present-dismissed';
const MAX_PRESENT_DISMISSED = 50;

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

export function getOnboarded(): boolean {
  return localStorage.getItem(KEY_ONBOARDED) === '1';
}

export function setOnboarded(): void {
  localStorage.setItem(KEY_ONBOARDED, '1');
}

// The reminder to present is best-effort: if storage is unavailable it shows,
// and dismissing it only lasts until the tab is closed.
export function getPresentReminders(): boolean {
  try {
    return localStorage.getItem(KEY_PRESENT_REMINDERS) !== '0';
  } catch {
    return true;
  }
}

export function setPresentReminders(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY_PRESENT_REMINDERS);
    else localStorage.setItem(KEY_PRESENT_REMINDERS, '0');
  } catch {
    // ignore
  }
}

function readPresentDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY_PRESENT_DISMISSED) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function isPresentReminderDismissed(slug: string): boolean {
  return readPresentDismissed().includes(slug);
}

export function dismissPresentReminder(slug: string): void {
  if (!slug) return;
  try {
    const list = [slug, ...readPresentDismissed().filter((s) => s !== slug)].slice(0, MAX_PRESENT_DISMISSED);
    localStorage.setItem(KEY_PRESENT_DISMISSED, JSON.stringify(list));
  } catch {
    // ignore
  }
}
