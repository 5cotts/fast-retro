import {
  createBoard,
  readCards,
  readBoardLabel,
  readBoardAnonymous,
  readBoardAutoSort,
  readBoardEndedAt,
  readBoardEndedMessage,
  type BoardState
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
  namesMap: Record<string, string>;
  cards: Record<ColumnKey, CardData[]>;
  timerState: TimerState;
  presence: PresenceUser[];
  phase: Phase;
  label: string;
  anonymous: boolean;
  autoSort: boolean;
  endedAt: number | null;
  endedMessage: string;
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
    namesMap: {},
    cards: { wentWell: [], toImprove: [], actions: [] },
    timerState: { durationSec: 0, startedAt: null, paused: false, pausedRemaining: null },
    presence: [],
    phase: 'brainstorm',
    label: '',
    anonymous: false,
    autoSort: true,
    endedAt: null,
    endedMessage: ''
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
      state.endedAt = readBoardEndedAt(meta);
      state.endedMessage = readBoardEndedMessage(meta);
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

    setDisplayName(names, init.userId, init.userName);

    const onStatus = (e: { status: string }) => {
      state.connected = e.status === 'connected';
    };
    provider.on('status', onStatus);

    updateAwarenessUser(provider, {
      name: init.userName,
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
