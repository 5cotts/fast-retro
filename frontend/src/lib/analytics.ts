// Thin wrapper over the GA4 tag in app.html. The tag is stripped server-side
// when GA_MEASUREMENT_ID is unset, so every call is a no-op without it.
// Never pass board labels, card text or names here: parameters are counts and
// fixed enums only.
export type AnalyticsEvent =
  | { name: 'board_export'; params: { format: 'board_file' | 'csv'; source: 'board' | 'end' | 'archive' } }
  | { name: 'board_import'; params: { result: 'success'; origin: 'file' | 'carryover'; cards: number } }
  | { name: 'board_import'; params: { result: 'error'; reason: ImportErrorCode } }
  | { name: 'next_retro'; params: { carried_actions: number } };

export type ImportErrorCode =
  | 'too_large'
  | 'read_failed'
  | 'invalid_json'
  | 'not_export'
  | 'bad_version'
  | 'newer_version'
  | 'too_many_cards'
  | 'too_many_comments';

export function track(event: AnalyticsEvent): void {
  try {
    if (typeof gtag === 'function') gtag('event', event.name, event.params);
  } catch {
    // Analytics must never break the app.
  }
}
