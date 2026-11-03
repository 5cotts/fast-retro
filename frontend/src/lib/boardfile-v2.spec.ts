import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import v2Text from './fixtures/board-v2.fastretro.json?raw';
import { BOARD_FILE_VERSION, boardFileColumns, exportBoardFile, parseBoardFile, serializeBoardFile, type BoardFile } from './boardfile';
import { readColumns } from './columns';
import { setUpAfterSync, readAllCards, readBoardImported, readBoardLabel, readBoardAnonymous, readBoardAutoSort } from './yboard';
import { readPhase } from './phase';
import { readNames } from './identity';

// The frozen v2 file (fixtures/README.md): a five-column brainstorm board.
// Compared against the file on disk, not against today's exporter.

function parseV2(): BoardFile {
  const r = parseBoardFile(v2Text);
  if (!r.ok) throw new Error(r.error);
  expect(r.warnings).toEqual([]);
  return r.file;
}

function freshState() {
  const doc = new Y.Doc();
  return {
    doc,
    board: doc.getMap<Y.Array<Y.Map<unknown>>>('board'),
    meta: doc.getMap<unknown>('meta'),
    names: doc.getMap<string>('names'),
    phase: doc.getMap<unknown>('phase')
  };
}

describe('frozen v2 board file', () => {
  it('is still a version this build can read', () => {
    expect(BOARD_FILE_VERSION).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(v2Text).version).toBe(2);
  });

  it('parses with its columns and cards intact', () => {
    const file = parseV2();
    const columns = boardFileColumns(file);
    expect(columns.map((c) => c.title)).toEqual([
      'How might we cut onboarding time for new hires?',
      'How might we make deploys boring?',
      'How might we make on-call less painful?',
      'How might we keep docs up to date?',
      'How might we have fewer meetings? ☕',
      'Action items'
    ]);
    expect(columns.map((c) => c.color)).toEqual(['emerald', 'amber', 'violet', 'rose', 'teal', 'sky']);
    expect(file.cards['c-onboard1'].map((c) => c.text)).toEqual(['Buddy system for week one', 'Pre-provisioned laptops\nwith dev env']);
    expect(file.cards['c-deploy22'][0].votes).toEqual(['u_alice', 'u_bob']);
    expect(file.cards['c-meet5555'][0].reactions).toEqual({ '🎉': ['u_alice', 'u_carol'] });
    expect(file.cards['c-oncall33']).toEqual([]);
    expect(file.names).toEqual({ u_alice: 'Alice', u_bob: 'Bob', u_carol: 'Carol' });
  });

  it('re-exports byte-for-byte', () => {
    expect(serializeBoardFile(parseV2())).toBe(v2Text);
  });

  it('imports into a board that exports back to the same file, apart from new IDs', () => {
    const file = parseV2();
    const state = freshState();
    setUpAfterSync(state, { file, origin: { kind: 'file' } });
    const columns = readColumns(state.meta);
    expect(columns).toEqual(boardFileColumns(file));
    const again = exportBoardFile(
      {
        label: readBoardLabel(state.meta),
        anonymous: readBoardAnonymous(state.meta),
        phase: readPhase(state.phase),
        autoSort: readBoardAutoSort(state.meta),
        columns,
        cards: readAllCards(state.board),
        namesMap: readNames(state.names)
      },
      file.exportedAt
    );
    const stripIds = (f: BoardFile) => JSON.parse(JSON.stringify(f, (k, v) => (k === 'id' ? undefined : v)));
    expect(stripIds(again)).toEqual(stripIds(file));
    expect(readBoardImported(state.meta)?.origin).toEqual({ kind: 'file' });
  });
});
