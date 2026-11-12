import {
  createBoard,
  readAllCards,
  readBoardLabel,
  readBoardEndedAt,
  readBoardEndedMessage,
  readBoardImported,
  type BoardState,
  type SeedSource,
  type ImportedInfo
} from './yboard';
import { readTimer } from './timer';
import { readNames, pickColor, setDisplayName } from './identity';
import { samePresence, updateAwarenessUser, type AwarenessUser } from './awareness';
import { clampPhase, phasesFor, readPhase, type Phase } from './phase';
import type { CardData, PresenceUser, TimerState } from './types';
import { DEFAULT_COLUMNS, readColumns, sameColumns, type ColumnDef } from './columns';
import { readClusters, type ClusterDef } from './clusters';
import { readLabels, type CanvasLabelData } from './labels';
import { readLayout, type BoardLayout } from './canvas';
import { BOARD_SETTING_DEFAULTS, readBoardSettings, sameSettings, type BoardSettings } from './settings';

export interface UseBoardConnectionInit {
  userId: string;
  userName: string;
  isLead: boolean;
  presenting?: boolean;
  slug: string;
  // Host only: how to set up a brand-new board on its first sync.
  seed?: SeedSource;
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
  // Every column array in the doc, keyed by column key. Look columns up with
  // `cards[col.key] ?? []`: a column's array may not have synced yet.
  cards: Record<string, CardData[]>;
  columns: ColumnDef[];
  // Every group record, including ones with no cards. See layoutBoard.
  clusters: ClusterDef[];
  // Floating labels, on a canvas board.
  labels: CanvasLabelData[];
  timerState: TimerState;
  presence: PresenceUser[];
  phase: Phase;
  label: string;
  settings: BoardSettings;
  layout: BoardLayout;
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
    cards: {},
    columns: DEFAULT_COLUMNS,
    clusters: [],
    labels: [],
    timerState: { durationSec: 0, startedAt: null, paused: false, pausedRemaining: null },
    presence: [],
    phase: 'brainstorm',
    label: '',
    settings: { ...BOARD_SETTING_DEFAULTS },
    layout: 'columns',
    endedAt: null,
    endedLive: false,
    endedMessage: '',
    imported: null
  });

  function start(init: UseBoardConnectionInit) {
    if (state.board) return; // already started

    const conn = createBoard(init.slug, init.seed);
    const { board, provider, doc, timer, names, phase, meta, clusters, labels } = conn;
    state.board = conn;
    state.currentClientId = doc.clientID;

    const recomputeCards = () => {
      state.cards = readAllCards(board);
    };
    const recomputeClusters = () => {
      state.clusters = readClusters(clusters);
    };
    const recomputeLabels = () => {
      state.labels = readLabels(labels);
    };
    const recomputeTimer = () => {
      state.timerState = readTimer(timer);
    };
    const recomputeNames = () => {
      state.namesMap = readNames(names);
    };
    const recomputePhase = () => {
      state.phase = clampPhase(readPhase(phase), phasesFor(state.columns));
    };
    const recomputeMeta = () => {
      const columns = readColumns(meta);
      if (!sameColumns(columns, state.columns)) {
        state.columns = columns;
        recomputePhase();
      }
      state.label = readBoardLabel(meta);
      state.layout = readLayout(meta);
      const settings = readBoardSettings(meta);
      if (!sameSettings(settings, state.settings)) state.settings = settings;
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
    clusters.observe(recomputeClusters);
    labels.observe(recomputeLabels);
    timer.observeDeep(recomputeTimer);
    names.observe(recomputeNames);
    phase.observe(recomputePhase);
    meta.observe(recomputeMeta);
    recomputeCards();
    recomputeClusters();
    recomputeLabels();
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
      typing: null,
      presenting: !!init.presenting
    });

    const aw = provider.awareness;
    const refreshPresence = () => {
      const out: PresenceUser[] = [];
      aw.getStates().forEach((s, cid) => {
        const u = (s as { user?: AwarenessUser }).user;
        if (u && typeof u.name === 'string') {
          out.push({
            clientId: cid,
            name: u.name,
            color: u.color ?? '#888',
            isLead: !!u.isLead,
            typing: u.typing ?? null,
            presenting: !!u.presenting
          });
        }
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      if (!samePresence(out, state.presence)) state.presence = out;
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
