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
