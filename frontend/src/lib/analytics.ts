import type { ImportErrorCode } from './boardfile';

// Thin wrapper over the GA4 tag in app.html. The tag is stripped server-side
// when GA_MEASUREMENT_ID is unset, so every call is a no-op without it.
// Never pass board labels, card text or names here: parameters are counts and
// fixed enums only.
export type AnalyticsEvent =
  | { name: 'board_export'; params: { format: 'board_file' | 'csv'; source: 'board' | 'end' | 'archive' | 'ended' } }
  | { name: 'board_import'; params: { result: 'success'; origin: 'file' | 'carryover'; cards: number } }
  | { name: 'board_import'; params: { result: 'error'; reason: ImportErrorCode } }
  | { name: 'next_retro'; params: { carried_actions: number } }
  | { name: 'card_group'; params: { action: 'create' | 'join' | 'leave' | 'ungroup' | 'merge'; source: 'drag' | 'menu' } }
  | { name: 'board_create'; params: { template: 'retro' | 'custom'; columns: number; action_items: boolean } }
  | {
      name: 'board_edit';
      params: {
        source: 'dialog' | 'inline';
        added: number;
        removed: number;
        renamed: number;
        reordered: boolean;
        settings_changed: number;
      };
    };

export function track(event: AnalyticsEvent): void {
  try {
    if (typeof gtag === 'function') gtag('event', event.name, event.params);
  } catch (err) {
    // Analytics must never break the app, but a silent failure would leave us
    // reading empty reports without knowing why.
    console.warn(`[analytics] failed to send ${event.name}`, err);
  }
}
