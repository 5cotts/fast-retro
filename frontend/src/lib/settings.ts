import type * as Y from 'yjs';

// Board-wide on/off settings, stored in the meta map. Only non-default values
// are stored (anonymous only when on, autoSort only when off), which is how
// these keys have always been written, so no migration is needed. Adding a
// setting is one default here plus one toggle in LeadControls.
export const BOARD_SETTING_DEFAULTS = {
  anonymous: false,
  autoSort: true,
  // Hide other people's cards during Brainstorm (see visibility.ts).
  hideCards: false
} as const;

export type BoardSettingKey = keyof typeof BOARD_SETTING_DEFAULTS;
export type BoardSettings = { [K in BoardSettingKey]: boolean };

export const BOARD_SETTING_KEYS = Object.keys(BOARD_SETTING_DEFAULTS) as BoardSettingKey[];

// Which settings apply to a board. Cards on a canvas never re-sort, so
// auto-sort isn't offered there.
export function settingsFor(layout: 'columns' | 'canvas'): BoardSettingKey[] {
  return layout === 'canvas' ? BOARD_SETTING_KEYS.filter((k) => k !== 'autoSort') : BOARD_SETTING_KEYS;
}

export function readBoardSetting(meta: Y.Map<unknown>, key: BoardSettingKey): boolean {
  const def = BOARD_SETTING_DEFAULTS[key];
  return meta.get(key) === !def ? !def : def;
}

export function readBoardSettings(meta: Y.Map<unknown>): BoardSettings {
  const out = {} as BoardSettings;
  for (const key of BOARD_SETTING_KEYS) out[key] = readBoardSetting(meta, key);
  return out;
}

export function setBoardSetting(meta: Y.Map<unknown>, key: BoardSettingKey, value: boolean): void {
  if (value === BOARD_SETTING_DEFAULTS[key]) meta.delete(key);
  else meta.set(key, value);
}

export function sameSettings(a: BoardSettings, b: BoardSettings): boolean {
  return BOARD_SETTING_KEYS.every((k) => a[k] === b[k]);
}

// How the Edit board dialog describes each setting. Keyed by the registry, so
// a new setting won't type-check until it has a label.
export const BOARD_SETTING_LABELS: Record<BoardSettingKey, { label: string; hint: string }> = {
  anonymous: { label: 'Anonymous', hint: 'Hide author names on cards and comments.' },
  autoSort: { label: 'Auto-sort by votes', hint: 'Cards reorder by vote count from Discuss onward.' },
  hideCards: { label: "Hide others' cards while brainstorming", hint: 'Everyone sees only their own cards until the Group phase.' }
};
