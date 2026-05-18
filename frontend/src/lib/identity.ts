import * as Y from 'yjs';
import { getUserId } from './storage';
import type { PresenceUser } from './types';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

// Seed with userId, not display name. Otherwise renaming yourself rotates the
// presence-dot color, which is jarring and breaks the "always the same person"
// affordance for other users.
export function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function getOrCreateUserId(): string {
  return getUserId();
}

export function setDisplayName(names: Y.Map<string>, userId: string, name: string) {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return;
  if (names.get(userId) !== trimmed) names.set(userId, trimmed);
}

export function readNames(names: Y.Map<string>): Record<string, string> {
  const out: Record<string, string> = {};
  names.forEach((v, k) => {
    if (typeof v === 'string' && v) out[k] = v;
  });
  return out;
}

export interface ResolveDisplayNameCtx {
  selfId: string;
  selfName: string;
  namesMap: Record<string, string>;
}

/**
 * Resolve a stable display name for an author id.
 *
 * Why both a `names` Y.Map *and* `awareness.user.name` exist:
 *   - `names` is persistent authorship: it lives in the CRDT and survives
 *     reconnects, so authorship labels on existing cards/comments stay stable
 *     even after a user disconnects.
 *   - `awareness.user.name` is ephemeral presence: who is *currently* on the
 *     board (used for the presence list and "X is typing" indicators).
 * They're updated together when a user joins or renames themselves.
 */
export function resolveDisplayName(authorId: string, ctx: ResolveDisplayNameCtx): string {
  if (!authorId) return 'Anonymous';
  if (authorId === ctx.selfId) return ctx.selfName || ctx.namesMap[authorId] || 'Anonymous';
  return ctx.namesMap[authorId] || 'Anonymous';
}

/**
 * Suffix duplicate display names with `(2)`, `(3)`, … so the presence list and
 * typing indicators never collapse two real people into one ambiguous label.
 * Order is deterministic per clientId so the suffix doesn't shuffle on rerender.
 */
export function disambiguateNames(presence: PresenceUser[]): PresenceUser[] {
  const buckets = new Map<string, PresenceUser[]>();
  for (const p of presence) {
    const key = p.name.trim().toLowerCase();
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  const suffixByClientId = new Map<number, string>();
  for (const list of buckets.values()) {
    if (list.length <= 1) continue;
    list.sort((a, b) => a.clientId - b.clientId);
    list.forEach((p, idx) => {
      if (idx > 0) suffixByClientId.set(p.clientId, ` (${idx + 1})`);
    });
  }
  if (suffixByClientId.size === 0) return presence;
  return presence.map((p) => {
    const suf = suffixByClientId.get(p.clientId);
    return suf ? { ...p, name: `${p.name}${suf}` } : p;
  });
}
