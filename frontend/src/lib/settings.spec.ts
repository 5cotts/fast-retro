import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BOARD_SETTING_DEFAULTS, BOARD_SETTING_KEYS, readBoardSettings, setBoardSetting, settingsFor } from './settings';
import { exportBoardFile, newBoardSeed, parseBoardFile, serializeBoardFile } from './boardfile';
import { setUpAfterSync } from './yboard';

const meta = () => new Y.Doc().getMap<unknown>('meta');

describe('board settings', () => {
  it('reads defaults from an empty board', () => {
    expect(readBoardSettings(meta())).toEqual(BOARD_SETTING_DEFAULTS);
  });

  it('stores only non-default values, as anonymous and autoSort always have', () => {
    const m = meta();
    setBoardSetting(m, 'anonymous', true);
    setBoardSetting(m, 'autoSort', false);
    setBoardSetting(m, 'hideCards', true);
    expect(m.toJSON()).toEqual({ anonymous: true, autoSort: false, hideCards: true });
    setBoardSetting(m, 'anonymous', false);
    setBoardSetting(m, 'autoSort', true);
    setBoardSetting(m, 'hideCards', false);
    expect(m.toJSON()).toEqual({});
  });

  it('reads the encoding older builds wrote', () => {
    const m = meta();
    m.set('anonymous', true);
    m.set('autoSort', false);
    expect(readBoardSettings(m)).toEqual({ anonymous: true, autoSort: false, hideCards: false });
  });
});

describe('hideCards in board files', () => {
  const source = (hideCards: boolean) => ({
    label: 'L',
    anonymous: false,
    phase: 'brainstorm' as const,
    autoSort: true,
    hideCards,
    cards: {},
    namesMap: {}
  });

  it('is written only when on and survives a round trip into a board', () => {
    expect(exportBoardFile(source(false)).board).not.toHaveProperty('hideCards');
    const file = exportBoardFile(source(true));
    expect(file.version).toBe(1);
    const parsed = parseBoardFile(serializeBoardFile(file));
    expect(parsed.ok && parsed.file.board.hideCards).toBe(true);
    const doc = new Y.Doc();
    const state = {
      doc,
      board: doc.getMap<Y.Array<Y.Map<unknown>>>('board'),
      meta: doc.getMap<unknown>('meta'),
      names: doc.getMap<string>('names'),
      phase: doc.getMap<unknown>('phase')
    };
    setUpAfterSync(state, { file: parsed.ok ? parsed.file : file, origin: { kind: 'file' } });
    expect(readBoardSettings(state.meta).hideCards).toBe(true);
  });

  it('is part of a new board seed', () => {
    expect(newBoardSeed({ label: '', anonymous: true, hideCards: true }).board.hideCards).toBe(true);
    expect(newBoardSeed({ label: '', anonymous: true }).board).not.toHaveProperty('hideCards');
  });
});

describe('settingsFor', () => {
  it('offers everything on a column board', () => {
    expect(settingsFor('columns')).toEqual(BOARD_SETTING_KEYS);
  });

  it('drops auto-sort on a canvas, where cards never re-sort', () => {
    expect(settingsFor('canvas')).toEqual(BOARD_SETTING_KEYS.filter((k) => k !== 'autoSort'));
  });
});
