import * as Y from 'yjs';
import { sanitizePos, type Point, type Rect } from './canvas';
import { newId } from './identity';

// Floating labels on a canvas board: text placed on the canvas, owning nothing.
// Moving one moves no cards. They store no author, so anonymous boards stay
// anonymous.

export const MAX_LABELS = 200;
export const MAX_LABEL_LEN = 60;

export interface LabelRecord extends Point {
  text: string;
}

export interface CanvasLabelData extends LabelRecord {
  id: string;
}

export type LabelMap = Y.Map<LabelRecord>;

export function labelMapOf(doc: Y.Doc): LabelMap {
  return doc.getMap<LabelRecord>('labels');
}

export function cleanLabelText(text: string): string {
  return text.trim().slice(0, MAX_LABEL_LEN);
}

function cleanRecord(raw: unknown): LabelRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { text } = raw as { text?: unknown };
  if (typeof text !== 'string') return null;
  const clean = cleanLabelText(text);
  const pos = sanitizePos(raw);
  return clean && pos ? { text: clean, x: pos.x, y: pos.y } : null;
}

// Any client can write to the doc, so what's read is validated here. Sorted by
// ID so everyone stacks them the same way.
export function readLabels(labels: LabelMap): CanvasLabelData[] {
  const out: CanvasLabelData[] = [];
  labels.forEach((value, id) => {
    const record = cleanRecord(value);
    if (record) out.push({ id, ...record });
  });
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, MAX_LABELS);
}

// Labels from a file or an archive. IDs aren't kept: importing gets new ones.
export function sanitizeFileLabels(raw: unknown): LabelRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LabelRecord[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_LABELS) break;
    const record = cleanRecord(entry);
    if (record) out.push(record);
  }
  return out;
}

// Returns null if there's nothing to add, or the board already has the most.
export function createLabel(labels: LabelMap, text: string, at: Point): string | null {
  const clean = cleanLabelText(text);
  const pos = sanitizePos(at);
  if (!clean || !pos || labels.size >= MAX_LABELS) return null;
  const id = newId();
  labels.set(id, { text: clean, x: pos.x, y: pos.y });
  return id;
}

export function moveLabel(labels: LabelMap, id: string, at: Point): void {
  const existing = cleanRecord(labels.get(id));
  const pos = sanitizePos(at);
  if (existing && pos) labels.set(id, { text: existing.text, x: pos.x, y: pos.y });
}

// Clearing a label's text deletes it.
export function editLabel(labels: LabelMap, id: string, text: string): void {
  const existing = cleanRecord(labels.get(id));
  if (!existing) return;
  const clean = cleanLabelText(text);
  if (!clean) labels.delete(id);
  else if (clean !== existing.text) labels.set(id, { ...existing, text: clean });
}

export function deleteLabel(labels: LabelMap, id: string): void {
  labels.delete(id);
}

const LABEL_CHAR_WIDTH = 10;
const LABEL_PADDING = 32;
const LABEL_HEIGHT = 40;

// About how much room a label takes, for Fit. Close is enough.
export function labelRect(label: LabelRecord): Rect {
  return { x: label.x, y: label.y, width: label.text.length * LABEL_CHAR_WIDTH + LABEL_PADDING, height: LABEL_HEIGHT };
}
