import * as Y from 'yjs';
import { getUserId } from './storage';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

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
