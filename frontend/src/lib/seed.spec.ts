import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBoardFile, newBoardSeed } from './boardfile';
import { DEFAULT_COLUMNS } from './columns';
import { readPhase } from './phase';
import {
  addCard,
  readBoardAnonymous,
  readBoardImported,
  readBoardLabel,
  readCards,
  setUpAfterSync,
  type PendingSeed
} from './yboard';

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

const blank = (label: string, anonymous: boolean): PendingSeed => ({
  file: newBoardSeed({ label, anonymous }, 1),
  origin: { kind: 'new' }
});

describe('setUpAfterSync', () => {
  it('seeds a blank board: label, settings and every column array in one update', () => {
    const state = freshState();
    let updates = 0;
    state.doc.on('update', () => updates++);
    expect(setUpAfterSync(state, blank('Sprint 9', true))).toBe(true);
    expect(updates).toBe(1);
    expect(readBoardLabel(state.meta)).toBe('Sprint 9');
    expect(readBoardAnonymous(state.meta)).toBe(true);
    expect(readPhase(state.phase)).toBe('brainstorm');
    expect([...state.board.keys()].sort()).toEqual(DEFAULT_COLUMNS.map((c) => c.key).sort());
    expect(readBoardImported(state.meta)).toBeNull();
  });

  it('marks file and carry-over seeds as imported', () => {
    const state = freshState();
    const file = exportBoardFile({
      label: 'Old',
      anonymous: false,
      phase: 'vote',
      autoSort: true,
      cards: { actions: [{ id: 'a', text: 'Do it', authorId: 'u1', votes: [], reactions: {}, comments: [] }] },
      namesMap: {}
    });
    setUpAfterSync(state, { file, origin: { kind: 'carryover', from: 'Old' } });
    expect(readBoardImported(state.meta)?.origin).toEqual({ kind: 'carryover', from: 'Old' });
    expect(readCards(state.board, 'actions').map((c) => c.text)).toEqual(['Do it']);
  });

  it('never seeds a board that already has cards', () => {
    const state = freshState();
    setUpAfterSync(state, null);
    addCard(state.board, 'wentWell', 'existing', 'u1');
    expect(setUpAfterSync(state, blank('Other', true))).toBe(false);
    expect(readBoardLabel(state.meta)).toBe('');
    expect(readBoardAnonymous(state.meta)).toBe(false);
  });

  it('still creates the column arrays without a seed', () => {
    const state = freshState();
    expect(setUpAfterSync(state, null)).toBe(false);
    expect(state.board.size).toBe(DEFAULT_COLUMNS.length);
  });
});
