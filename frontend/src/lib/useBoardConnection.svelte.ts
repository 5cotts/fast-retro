import {
  createBoard,
  readCards,
  readBoardLabel,
  readBoardAnonymous,
  readBoardAutoSort,
  readBoardEndedAt,
  readBoardEndedMessage,
  readBoardImported,
  type BoardState,
  type ImportedInfo
} from './yboard';
import { readTimer } from './timer';
import { readNames, pickColor, setDisplayName } from './identity';
import { updateAwarenessUser } from './awareness';
import { readPhase, type Phase } from './phase';
import type { CardData, ColumnKey, PresenceUser, TimerState } from './types';

export interface UseBoardConnectionInit {
  userId: string;
  userName: string;
  isLead: boolean;
  slug: string;
}

export interface UseBoardConnectionState {
  board: BoardState | null;
  cleanup: (() => void) | null;
  currentClientId: number;
  connected: boolean;
  // True once the first full sync from the server has landed. Until then the
  // board may look empty even if it isn't, so exports wait for this.
  synced: boolean;
  namesMap: Record<string, string>;
  cards: Record<ColumnKey, CardData[]>;
  timerState: TimerState;
  presence: PresenceUser[];
  phase: Phase;
  label: string;
  anonymous: boolean;
  autoSort: boolean;
  endedAt: number | null;
  // True only if the retro ended while this client was connected and synced,
  // as opposed to the board already being ended when it loaded. Drives the
  // end-of-retro celebration.
  endedLive: boolean;
  endedMessage: string;
  imported: ImportedInfo | null;
}

/**
 * Sets up the Yjs board / websocket / awareness lifecycle and surfaces a
 * reactive state object the caller can read directly in markup.
 *
 * Usage:
 *   const conn = useBoardConnection();
 *   conn.start({ userId, userName, isLead });
 *   // conn.state.cards, conn.state.presence, etc. are all reactive
 *   onDestroy(conn.destroy);
 */
export function useBoardConnection() {
  const state: UseBoardConnectionState = $state({
    board: null,
    cleanup: null,
    currentClientId: -1,
    connected: false,
    synced: false,
    namesMap: {},
    cards: { wentWell: [], toImprove: [], actions: [] },
    timerState: { durationSec: 0, startedAt: null, paused: false, pausedRemaining: null },
    presence: [],
    phase: 'brainstorm',
    label: '',
    anonymous: false,
    autoSort: true,
    endedAt: null,
    endedLive: false,
    endedMessage: '',
    imported: null
  });

  function start(init: UseBoardConnectionInit) {
    if (state.board) return; // already started

    const conn = createBoard(init.slug);
    const { board, provider, doc, timer, names, phase, meta } = conn;
    state.board = conn;
    state.currentClientId = doc.clientID;

    const recomputeCards = () => {
      state.cards = {
        wentWell: readCards(board, 'wentWell'),
        toImprove: readCards(board, 'toImprove'),
        actions: readCards(board, 'actions')
      };
    };
    const recomputeTimer = () => {
      state.timerState = readTimer(timer);
    };
    const recomputeNames = () => {
      state.namesMap = readNames(names);
    };
    const recomputePhase = () => {
      state.phase = readPhase(phase);
    };
    const recomputeMeta = () => {
      state.label = readBoardLabel(meta);
      state.anonymous = readBoardAnonymous(meta);
      state.autoSort = readBoardAutoSort(meta);
      const endedAt = readBoardEndedAt(meta);
      // Observers run synchronously while an update is applied, and y-websocket
      // only flips `synced` after the initial state has been applied, so an
      // endedAt that arrives with the initial load is not counted as live.
      if (endedAt !== null && state.endedAt === null && provider.synced) state.endedLive = true;
      state.endedAt = endedAt;
      state.endedMessage = readBoardEndedMessage(meta);
      state.imported = readBoardImported(meta);
    };

    board.observeDeep(recomputeCards);
    timer.observeDeep(recomputeTimer);
    names.observe(recomputeNames);
    phase.observe(recomputePhase);
    meta.observe(recomputeMeta);
    recomputeCards();
    recomputeTimer();
    recomputeNames();
    recomputePhase();
    recomputeMeta();

    // A viewer of an ended board may have no name (they skip the prompt).
    // Don't write an empty name into the board's names map.
    if (init.userName) setDisplayName(names, init.userId, init.userName);

    const onStatus = (e: { status: string }) => {
      state.connected = e.status === 'connected';
    };
    provider.on('status', onStatus);
    const onSync = (isSynced: boolean) => {
      state.synced = isSynced;
    };
    provider.on('sync', onSync);
    state.synced = provider.synced;

    updateAwarenessUser(provider, {
      name: init.userName || 'Guest',
      color: pickColor(init.userId),
      isLead: init.isLead,
      typing: null
    });

    const aw = provider.awareness;
    const refreshPresence = () => {
      const out: PresenceUser[] = [];
      aw.getStates().forEach((s, cid) => {
        const u = (s as { user?: { name?: string; color?: string; isLead?: boolean; typing?: string | null } }).user;
        if (u && typeof u.name === 'string') {
          out.push({
            clientId: cid,
            name: u.name,
            color: u.color ?? '#888',
            isLead: !!u.isLead,
            typing: u.typing ?? null
          });
        }
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      state.presence = out;
    };
    aw.on('change', refreshPresence);
    refreshPresence();

    const beforeUnload = () => {
      aw.setLocalState(null);
    };
    window.addEventListener('beforeunload', beforeUnload);

    state.cleanup = () => {
      window.removeEventListener('beforeunload', beforeUnload);
      board.unobserveDeep(recomputeCards);
      timer.unobserveDeep(recomputeTimer);
      names.unobserve(recomputeNames);
      phase.unobserve(recomputePhase);
      meta.unobserve(recomputeMeta);
      aw.off('change', refreshPresence);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      aw.setLocalState(null);
      provider.destroy();
      doc.destroy();
    };
  }

  function destroy() {
    if (state.cleanup) {
      state.cleanup();
      state.cleanup = null;
    }
    state.board = null;
  }

  return {
    state,
    start,
    destroy
  };
}
