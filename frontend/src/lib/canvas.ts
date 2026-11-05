import type * as Y from 'yjs';
import type { CardPos } from './types';

// The geometry of a canvas board, with no DOM or Yjs in it. World coordinates
// are the same for everyone; screen coordinates depend on each person's pan and
// zoom, which never go in the doc.

export type BoardLayout = 'columns' | 'canvas';

export const WORLD_LIMIT = 20_000;
const MAX_Z = 1_000_000_000;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;

// The starting grid. Slots are a fixed size, not measured, so a card's slot
// never depends on the height of the cards above it.
export const CARD_WIDTH = 260;
export const CARD_SLOT_HEIGHT = 190;
export const GRID_GAP_X = 40;
export const HEADING_HEIGHT = 56;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

// `pan` is where the world's origin sits on screen.
export interface View {
  panX: number;
  panY: number;
  zoom: number;
}

export const DEFAULT_VIEW: View = { panX: 0, panY: 0, zoom: 1 };

export function readLayout(meta: Y.Map<unknown>): BoardLayout {
  return meta.get('layout') === 'canvas' ? 'canvas' : 'columns';
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Any client can write to the doc and any file can say anything, so positions
// are checked on every read. Null means the card is still in its starting slot.
export function sanitizePos(raw: unknown): CardPos | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, z } = raw as { x?: unknown; y?: unknown; z?: unknown };
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return {
    x: clamp(x, -WORLD_LIMIT, WORLD_LIMIT),
    y: clamp(y, -WORLD_LIMIT, WORLD_LIMIT),
    z: isFiniteNumber(z) ? clamp(z, 0, MAX_Z) : 0
  };
}

export function headingPosition(columnIndex: number): Point {
  return { x: columnIndex * (CARD_WIDTH + GRID_GAP_X), y: 0 };
}

// `slot` is the card's index in its column's array, counting moved cards, so a
// moved card leaves a gap and the cards around it stay put.
export function gridPosition(columnIndex: number, slot: number): Point {
  return {
    x: headingPosition(columnIndex).x,
    y: HEADING_HEIGHT + slot * CARD_SLOT_HEIGHT
  };
}

export function screenToWorld(view: View, p: Point): Point {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom };
}

export function worldToScreen(view: View, p: Point): Point {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}

// Keeps the world point under `at` where it is on screen.
export function zoomAt(view: View, at: Point, zoom: number): View {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const anchor = screenToWorld(view, at);
  return { panX: at.x - anchor.x * next, panY: at.y - anchor.y * next, zoom: next };
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Centers the bounds in the viewport. Never zooms in past 100%, so a nearly
// empty board doesn't open with giant cards.
export function fitToBounds(bounds: Rect | null, viewport: Size, padding = 32): View {
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return DEFAULT_VIEW;
  const usableW = Math.max(1, viewport.width - padding * 2);
  const usableH = Math.max(1, viewport.height - padding * 2);
  const fit = Math.min(usableW / Math.max(1, bounds.width), usableH / Math.max(1, bounds.height));
  const zoom = clamp(fit, MIN_ZOOM, 1);
  return {
    panX: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    panY: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom
  };
}

// The z for a card just dropped: on top of everything.
export function nextZ(positions: readonly (CardPos | null | undefined)[]): number {
  let top = 0;
  for (const p of positions) if (p && p.z > top) top = p.z;
  return Math.min(top + 1, MAX_Z);
}

// Paint order, the same for everyone: lowest z first, ties by card ID.
export function compareStack(a: { id: string; z: number }, b: { id: string; z: number }): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
