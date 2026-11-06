import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAX_LABELS,
  MAX_LABEL_LEN,
  createLabel,
  deleteLabel,
  editLabel,
  labelMapOf,
  moveLabel,
  readLabels,
  sanitizeFileLabels,
  type LabelMap
} from './labels';
import { WORLD_LIMIT } from './canvas';
import { boardFileFromArchive, exportBoardFile, parseBoardFile, serializeBoardFile } from './boardfile';
import { seedBoard } from './yboard';

const map = (): LabelMap => labelMapOf(new Y.Doc());

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('labels in the doc', () => {
  it('creates, moves, edits and deletes', () => {
    const labels = map();
    const id = createLabel(labels, '  Deploys  ', { x: 10, y: 20 })!;
    expect(readLabels(labels)).toEqual([{ id, text: 'Deploys', x: 10, y: 20 }]);
    moveLabel(labels, id, { x: 30, y: 40 });
    editLabel(labels, id, 'Onboarding');
    expect(readLabels(labels)).toEqual([{ id, text: 'Onboarding', x: 30, y: 40 }]);
    deleteLabel(labels, id);
    expect(readLabels(labels)).toEqual([]);
  });

  it('caps the text and refuses a blank label', () => {
    const labels = map();
    expect(createLabel(labels, '   ', { x: 0, y: 0 })).toBeNull();
    const id = createLabel(labels, 'x'.repeat(MAX_LABEL_LEN + 10), { x: 0, y: 0 })!;
    expect(readLabels(labels)[0].text).toHaveLength(MAX_LABEL_LEN);
    editLabel(labels, id, '  ');
    expect(readLabels(labels)).toEqual([]);
  });

  it('stops at the most a board can have', () => {
    const labels = map();
    for (let i = 0; i < MAX_LABELS; i++) createLabel(labels, `l${i}`, { x: i, y: 0 });
    expect(createLabel(labels, 'one more', { x: 0, y: 0 })).toBeNull();
    expect(readLabels(labels)).toHaveLength(MAX_LABELS);
  });

  it('ignores what a bad client wrote, and clamps positions', () => {
    const labels = map();
    labels.set('a', { text: 'ok', x: WORLD_LIMIT * 3, y: 0 });
    labels.set('b', { text: '', x: 0, y: 0 });
    labels.set('c', { text: 'no position' } as never);
    labels.set('d', 'nope' as never);
    expect(readLabels(labels)).toEqual([{ id: 'a', text: 'ok', x: WORLD_LIMIT, y: 0 }]);
  });

  it('does nothing to a label that is gone', () => {
    const labels = map();
    moveLabel(labels, 'gone', { x: 1, y: 2 });
    editLabel(labels, 'gone', 'text');
    expect(readLabels(labels)).toEqual([]);
  });

  it('converges when two people move one label, and in the same stacking order', () => {
    const [docA, docB] = [new Y.Doc(), new Y.Doc()];
    const [a, b] = [labelMapOf(docA), labelMapOf(docB)];
    const id = createLabel(a, 'Shared', { x: 0, y: 0 })!;
    createLabel(a, 'Other', { x: 5, y: 5 });
    sync(docA, docB);
    moveLabel(a, id, { x: 100, y: 100 });
    moveLabel(b, id, { x: 200, y: 200 });
    sync(docA, docB);
    expect(readLabels(a)).toEqual(readLabels(b));
  });
});

describe('sanitizeFileLabels', () => {
  it('keeps good entries and skips the rest', () => {
    expect(
      sanitizeFileLabels([
        { text: 'Good', x: 1, y: 2, id: 'dropped' },
        { text: '', x: 1, y: 2 },
        { text: 'No position' },
        { x: 1, y: 2 },
        'nope'
      ])
    ).toEqual([{ text: 'Good', x: 1, y: 2 }]);
    expect(sanitizeFileLabels('nope')).toEqual([]);
  });

  it('caps the count and the text', () => {
    const many = Array.from({ length: MAX_LABELS + 5 }, (_, i) => ({ text: `l${i}`, x: 0, y: 0 }));
    expect(sanitizeFileLabels(many)).toHaveLength(MAX_LABELS);
    expect(sanitizeFileLabels([{ text: 'y'.repeat(100), x: 0, y: 0 }])[0].text).toHaveLength(MAX_LABEL_LEN);
  });
});

describe('labels in a board file', () => {
  const source = {
    label: 'L',
    anonymous: true,
    phase: 'group' as const,
    autoSort: true,
    layout: 'canvas' as const,
    labels: [{ text: 'Deploys', x: 10, y: -20 }],
    cards: {},
    namesMap: {}
  };

  it('round-trips on a canvas board, without IDs', () => {
    const withId = { ...source, labels: [{ id: 'local', text: 'Deploys', x: 10, y: -20 }] };
    const file = exportBoardFile(withId);
    expect(file.version).toBe(4);
    expect(file.board.labels).toEqual([{ text: 'Deploys', x: 10, y: -20 }]);
    const parsed = parseBoardFile(serializeBoardFile(file));
    expect(parsed.ok && parsed.file.board.labels).toEqual([{ text: 'Deploys', x: 10, y: -20 }]);
  });

  it('writes nothing when there are none, or on a column board', () => {
    expect(exportBoardFile({ ...source, labels: [] }).board).not.toHaveProperty('labels');
    expect(exportBoardFile({ ...source, layout: 'columns' }).board).not.toHaveProperty('labels');
    const raw = JSON.stringify({ format: 'fast-retro', version: 1, exportedAt: 1, board: { label: 'x', anonymous: true, phase: 'group', autoSort: true, labels: [{ text: 'a', x: 0, y: 0 }] }, cards: {} });
    const parsed = parseBoardFile(raw);
    expect(parsed.ok && parsed.file.board).not.toHaveProperty('labels');
  });

  it('cleans bad labels on import', () => {
    const raw = serializeBoardFile(exportBoardFile(source)).replace('"Deploys"', '""');
    const parsed = parseBoardFile(raw);
    expect(parsed.ok && parsed.file.board).not.toHaveProperty('labels');
  });

  it('comes through an archive', () => {
    const file = boardFileFromArchive({ label: 'A', cards: {}, names: {}, endedAt: 1, layout: 'canvas', labels: [{ text: 'Kept', x: 1, y: 2 }, 'junk'] });
    expect(file.board.labels).toEqual([{ text: 'Kept', x: 1, y: 2 }]);
  });

  it('seeds a board with new IDs each time', () => {
    const seed = () => {
      const doc = new Y.Doc();
      seedBoard(
        { doc, board: doc.getMap('board'), meta: doc.getMap('meta'), names: doc.getMap('names'), phase: doc.getMap('phase') },
        exportBoardFile(source)
      );
      return readLabels(labelMapOf(doc));
    };
    const [a, b] = [seed(), seed()];
    expect(a).toMatchObject([{ text: 'Deploys', x: 10, y: -20 }]);
    expect(a[0].id).not.toBe(b[0].id);
  });
});
