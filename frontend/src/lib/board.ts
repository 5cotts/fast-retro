// Re-export aggregator. The original board.ts grew unwieldy and has been
// split into:
//   - types.ts     : interfaces, COLUMNS, placeholders
//   - emojis.ts    : reaction emoji catalog + search
//   - yboard.ts    : Yjs board/card primitives
//   - timer.ts     : timer state machine + formatting
//   - csv.ts       : CSV export
//   - identity.ts  : user id, color, display-name resolution
//   - storage.ts   : typed localStorage accessors
//
// New code should import from those modules directly. This file exists so
// older imports keep working during the transition.
export * from './types';
export * from './yboard';
export * from './timer';
export * from './csv';
export * from './identity';
