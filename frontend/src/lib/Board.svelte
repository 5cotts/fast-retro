<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import BoardColumn from './BoardColumn.svelte';
  import BoardHeader from './BoardHeader.svelte';
  import ExportMenu from './ExportMenu.svelte';
  import NamePrompt from './NamePrompt.svelte';
  import EditBoardModal from './EditBoardModal.svelte';
  import Onboarding from './Onboarding.svelte';
  import {
    addCard,
    editCardText,
    deleteCard,
    toggleVote,
    toggleReaction,
    addComment,
    deleteComment,
    moveCard,
    setBoardLabel,
    setBoardEnded,
    applyBoardEdit,
    createCluster,
    renameCluster,
    setCardCluster,
    dissolveCluster,
    mergeCluster,
    type BoardEdit,
    countCards,
    type SeedSource
  } from './yboard';
  import { pickMotivationalMessage } from './motivation';
  import confetti from 'canvas-confetti';
  import {
    recordRecentBoard,
    consumePendingSeed,
    setHostKey,
    setPendingSeed,
    newSlug,
    slugifyLabel
  } from './boards';
  import { createBoard, endBoard } from './api';
  import { goto } from '$app/navigation';
  import {
    readTimer,
    setTimerDuration,
    startTimer,
    pauseTimer,
    resetTimer,
    computeTimerRemaining
  } from './timer';
  import { exportCSV } from './csv';
  import {
    clustersInUse,
    exportBoardFile,
    newBoardSeed,
    downloadBoardFile,
    downloadBlob,
    exportFileStem,
    MAX_IMPORT_CARDS,
    MAX_IMPORT_COMMENTS_PER_CARD
  } from './boardfile';
  import { track } from './analytics';
  import { getOrCreateUserId, setDisplayName } from './identity';
  import { getName, setName, getTheme, setTheme, getOnboarded, setOnboarded, type ThemePref } from './storage';
  import { updateAwarenessUser } from './awareness';
  import { useBoardConnection } from './useBoardConnection.svelte';
  import { setBoardSetting, type BoardSettingKey } from './settings';
  import { isHidingCards } from './visibility';
  import { canEditClusters, clustersVisible, layoutBoard, planDrop, reorderTarget, sameDropTarget, sectionOf, type ClusterActions, type ClusterLane, type DropTarget } from './clusters';
  import type { CardData } from './types';
  import { ACTIONS_COLUMN_KEY, DEFAULT_COLUMNS, boardGridClass, hasActionsColumn, isWideBoard, renameColumn, sameColumns } from './columns';
  import { disambiguateNames, disambiguateNamesMap } from './identity';
  import { Download, ArrowLeft, ArrowRight, PartyPopper, X, FileUp, History, Blinds } from 'lucide-svelte';
  import {
    phasesFor,
    PHASE_LABEL,
    PHASE_HINT,
    nextPhase,
    prevPhase,
    setPhase,
    canAddCardInColumn,
    canVoteInPhase,
    canSortByVotes
  } from './phase';

  let {
    isLead = false,
    slug,
    leadToken = '',
    hostKey = '',
    readOnly = false
  } = $props<{
    isLead?: boolean;
    slug: string;
    leadToken?: string;
    hostKey?: string;
    readOnly?: boolean;
  }>();

  // A board the host has ended is read-only for everyone. Seeded from the
  // server status (readOnly prop) and flipped locally the moment this host
  // ends it.
  let ended = $state<boolean>(readOnly);
  let startingNext = $state<boolean>(false);
  let carryActions = $state<boolean>(true);
  // Lead controls only apply to a live board — an ended retro is frozen.
  const effectiveLead = $derived(isLead && !ended);

  let userName = $state<string>('');
  let promptingName = $state<boolean>(true);
  let nameInput = $state<string>('');
  let userId = $state<string>('');
  let showOnboarding = $state<boolean>(false);

  const conn = useBoardConnection();

  let themePref = $state<ThemePref>('auto');
  let systemDark = $state<boolean>(false);
  const darkMode = $derived(themePref === 'dark' || (themePref === 'auto' && systemDark));
  let mediaQuery: MediaQueryList | null = null;
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  let nowTick = $state<number>(Date.now());
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  let timerInputMin = $state<string>('5');
  let dragCardId = $state<string | null>(null);
  let dragFromCol = $state<string | null>(null);
  let dropTarget = $state<DropTarget | null>(null);
  let coarsePointer = $state<boolean>(false);
  let reducedMotion = $state<boolean>(false);
  let prevTimerExpired = $state<boolean>(false);
  let timerJustExpired = $state<boolean>(false);
  let timerExpiredHandle: ReturnType<typeof setTimeout> | null = null;

  // Celebration toast shown to every connected client the moment the retro
  // ends (see the effect below watching conn.state.endedAt). Auto-dismisses,
  // but can also be closed early.
  let prevEndedAt = $state<number | null>(null);
  let showEndCelebration = $state<boolean>(false);
  let endCelebrationHandle: ReturnType<typeof setTimeout> | null = null;

  // Disconnect banner: only surface after the connection has been down for
  // long enough that a transient hiccup wouldn't trigger it. The header pill
  // still flips immediately; this is the louder fallback for real outages.
  const DISCONNECT_BANNER_DELAY_MS = 10_000;
  let showDisconnectBanner = $state<boolean>(false);
  let disconnectHandle: ReturnType<typeof setTimeout> | null = null;

  // Off-screen live region for timer state transitions. The per-second count
  // is intentionally aria-live="off" (announcing each tick would be hostile);
  // start/pause/reset/expire transitions are announced here instead.
  let timerAnnouncement = $state<string>('');
  let prevTimerRunning = $state<boolean>(false);
  let prevTimerPaused = $state<boolean>(false);
  let prevTimerDuration = $state<number>(0);

  let focusedCardId = $state<string | null>(null);
  let endConfirm = $state<boolean>(false);

  const remainingSec = $derived(computeTimerRemaining(conn.state.timerState, nowTick));
  const timerRunning = $derived(
    conn.state.timerState.startedAt !== null &&
      !conn.state.timerState.paused &&
      remainingSec > 0
  );
  const timerExpired = $derived(
    conn.state.timerState.durationSec > 0 &&
      remainingSec === 0 &&
      conn.state.timerState.startedAt !== null &&
      !conn.state.timerState.paused
  );

  const presenceDisambiguated = $derived(disambiguateNames(conn.state.presence));
  const namesMapDisambiguated = $derived(disambiguateNamesMap(conn.state.namesMap));

  // In anonymous mode, who's typing is just as identifying as the card's
  // eventual author name — so real names are swapped for a generic label,
  // deduped so N simultaneous anonymous typers on one card/composer still
  // read as a single "Someone", not a repeated-string headcount leak.
  const typingByCard = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const p of presenceDisambiguated) {
      if (p.typing && p.clientId !== conn.state.currentClientId) {
        const label = conn.state.settings.anonymous ? 'Someone' : p.name;
        const list = map.get(p.typing) ?? [];
        if (!list.includes(label)) list.push(label);
        map.set(p.typing, list);
      }
    }
    return map;
  });

  onMount(() => {
    userId = getOrCreateUserId();
    themePref = getTheme();

    if (typeof window !== 'undefined' && window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      systemDark = mediaQuery.matches;
      mediaListener = (e) => {
        systemDark = e.matches;
      };
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', mediaListener);
      else mediaQuery.addListener(mediaListener);

      coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    const storedName = getName();
    if (storedName) {
      userName = storedName;
      promptingName = false;
      // Returning users (already had a name persisted) are grandfathered out
      // of the first-run onboarding overlay — they already know the product.
      if (!getOnboarded()) setOnboarded();
      startConnection();
    } else if (readOnly) {
      // An ended board can't be edited, so a name isn't needed to view or
      // export it. Skip the prompt (and onboarding) and connect as a guest.
      promptingName = false;
      startConnection();
    }
    tickHandle = setInterval(() => {
      nowTick = Date.now();
    }, 1000);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', darkMode);
  });

  // Fire a brief one-shot animation banner the moment the timer expires.
  $effect(() => {
    const expired = timerExpired;
    if (expired && !prevTimerExpired) {
      timerJustExpired = true;
      timerAnnouncement = "Timer expired — time's up.";
      if (timerExpiredHandle !== null) clearTimeout(timerExpiredHandle);
      timerExpiredHandle = setTimeout(() => {
        timerJustExpired = false;
      }, 6000);
    }
    prevTimerExpired = expired;
  });

  let confettiIntervalHandle: ReturnType<typeof setInterval> | null = null;
  let confettiFire: ReturnType<typeof confetti.create> | null = null;

  // The default `confetti(...)` export's lazy singleton hardcodes
  // useWorker: true, which renders via a Worker built from a `blob:` URL.
  // This app's CSP has no worker-src/blob: allowance, so that worker is
  // silently blocked and nothing ever draws — the canvas still gets created
  // and correctly sized, it just stays empty. A custom instance defaults
  // useWorker to false and renders on the main thread instead, which
  // respects the CSP and actually shows up.
  function getConfettiFire() {
    if (!confettiFire) {
      confettiFire = confetti.create(undefined, { resize: true, useWorker: false });
    }
    return confettiFire;
  }

  function stopConfettiShow() {
    if (confettiIntervalHandle !== null) {
      clearInterval(confettiIntervalHandle);
      confettiIntervalHandle = null;
    }
  }

  // Big, full-screen, multi-second shower (think iMessage "Congratulations")
  // rather than a quick corner-burst: an immediate large center pop for
  // instant impact, then ~3s of randomized bursts raining across the whole
  // width so it reads as covering the screen, not one small corner of it.
  function fireConfettiShow() {
    stopConfettiShow();
    const fire = getConfettiFire();
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 40, spread: 360, ticks: 100, zIndex: 1000, scalar: 1.1 };

    fire({
      ...defaults,
      particleCount: 180,
      spread: 130,
      startVelocity: 55,
      origin: { x: 0.5, y: 0.5 }
    });

    confettiIntervalHandle = setInterval(() => {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) {
        stopConfettiShow();
        return;
      }
      const particleCount = 70 * (timeLeft / duration);
      fire({
        ...defaults,
        particleCount,
        origin: { x: Math.random() * 0.3, y: Math.random() * 0.5 - 0.1 }
      });
      fire({
        ...defaults,
        particleCount,
        origin: { x: 0.7 + Math.random() * 0.3, y: Math.random() * 0.5 - 0.1 }
      });
      fire({
        ...defaults,
        particleCount: particleCount * 0.7,
        origin: { x: 0.3 + Math.random() * 0.4, y: Math.random() * 0.3 - 0.1 }
      });
    }, 250);
  }

  function dismissEndCelebration() {
    showEndCelebration = false;
    if (endCelebrationHandle !== null) {
      clearTimeout(endCelebrationHandle);
      endCelebrationHandle = null;
    }
  }

  // Fires for every connected client — not just the lead who clicked End —
  // the moment endedAt shows up on the meta map while they're connected (see setBoardEnded in
  // confirmEndBoard). Also flips the local `ended` flag so participants see
  // the read-only banner live instead of only after a reload.
  $effect(() => {
    const endedAt = conn.state.endedAt;
    if (endedAt !== null && endedAt !== prevEndedAt) {
      ended = true;
      // Only celebrate a live end, not a board that was already ended when
      // it was opened or reloaded.
      if (conn.state.endedLive) {
        showEndCelebration = true;
        if (!reducedMotion) fireConfettiShow();
        if (endCelebrationHandle !== null) clearTimeout(endCelebrationHandle);
        endCelebrationHandle = setTimeout(() => {
          showEndCelebration = false;
        }, 9000);
      }
    }
    prevEndedAt = endedAt;
  });

  // Announce timer state transitions for screen readers (without spamming
  // the per-second count).
  $effect(() => {
    const running = timerRunning;
    const paused = conn.state.timerState.paused;
    const duration = conn.state.timerState.durationSec;
    if (running && !prevTimerRunning) {
      const min = Math.round(duration / 60);
      timerAnnouncement = `Timer started: ${min} minute${min === 1 ? '' : 's'}.`;
    } else if (!running && prevTimerRunning && paused) {
      timerAnnouncement = 'Timer paused.';
    } else if (duration === 0 && prevTimerDuration > 0 && !timerExpired) {
      timerAnnouncement = 'Timer reset.';
    }
    prevTimerRunning = running;
    prevTimerPaused = paused;
    prevTimerDuration = duration;
  });

  // Surface the disconnect banner only if the connection stays down past the
  // delay window. Reconnect clears immediately and cancels any pending timer.
  $effect(() => {
    const isConnected = conn.state.connected;
    if (!isConnected) {
      if (disconnectHandle === null && !showDisconnectBanner) {
        disconnectHandle = setTimeout(() => {
          showDisconnectBanner = true;
          disconnectHandle = null;
        }, DISCONNECT_BANNER_DELAY_MS);
      }
    } else {
      if (disconnectHandle !== null) {
        clearTimeout(disconnectHandle);
        disconnectHandle = null;
      }
      showDisconnectBanner = false;
    }
  });

  onDestroy(() => {
    conn.destroy();
    if (tickHandle !== null) clearInterval(tickHandle);
    if (timerExpiredHandle !== null) clearTimeout(timerExpiredHandle);
    if (disconnectHandle !== null) clearTimeout(disconnectHandle);
    if (endCelebrationHandle !== null) clearTimeout(endCelebrationHandle);
    stopConfettiShow();
    if (mediaQuery && mediaListener) {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', mediaListener);
      else mediaQuery.removeListener(mediaListener);
    }
  });

  function cycleTheme() {
    const next: ThemePref = themePref === 'auto' ? 'light' : themePref === 'light' ? 'dark' : 'auto';
    themePref = next;
    setTheme(next);
  }

  function commitName() {
    const t = nameInput.trim();
    if (!t) return;
    userName = t;
    setName(t);
    promptingName = false;
    if (!getOnboarded()) showOnboarding = true;
    startConnection();
  }

  // Only the host sets up a new board, from the seed its creator stashed
  // (see setPendingSeed). Taken on the first sync, so a refresh before then
  // doesn't lose it.
  const seedSource: SeedSource = {
    take: () => consumePendingSeed(slug),
    onApplied: ({ file, origin }) => {
      if (origin.kind === 'file') {
        track({ name: 'board_import', params: { result: 'success', origin: 'file', cards: countCards(file.cards) } });
      }
    }
  };

  function startConnection() {
    conn.start({ userId, userName, isLead, slug, seed: isLead ? seedSource : undefined });
  }

  function dismissOnboarding() {
    setOnboarded();
    showOnboarding = false;
  }

  function changeName(newName: string) {
    const t = newName.trim().slice(0, 40);
    if (!t || t === userName) return;
    userName = t;
    setName(t);
    if (conn.state.board) {
      setDisplayName(conn.state.board.names, userId, t);
      updateAwarenessUser(conn.state.board.provider, { name: t });
    }
  }

  function changeLabel(next: string) {
    if (!conn.state.board || !isLead) return;
    setBoardLabel(conn.state.board.meta, next);
  }

  function toggleSetting(key: BoardSettingKey) {
    if (!conn.state.board || !isLead) return;
    setBoardSetting(conn.state.board.meta, key, !conn.state.settings[key]);
  }

  // Edit board: host only, until the board ends (the server drops writes to
  // an ended board anyway).
  let editingBoard = $state(false);
  // Set while this client saves an edit, so it doesn't notify itself.
  let ownColumnEdit = false;

  function openEditBoard() {
    if (!conn.state.board || !effectiveLead) return;
    editingBoard = true;
  }

  function saveBoardEdit(edit: BoardEdit, source: 'dialog' | 'inline') {
    editingBoard = false;
    if (!conn.state.board || !effectiveLead) return;
    const r = applyBoardEdit(conn.state.board, edit);
    // The columns effect only reruns when the list changed.
    ownColumnEdit = r.added.length + r.removed.length + r.renamed > 0 || r.reordered;
    if (r.added.length + r.removed.length + r.renamed + r.settingsChanged === 0 && !r.reordered) return;
    track({
      name: 'board_edit',
      params: {
        source,
        added: r.added.length,
        removed: r.removed.length,
        renamed: r.renamed,
        reordered: r.reordered,
        settings_changed: r.settingsChanged
      }
    });
  }

  function renameColumnInline(key: string, title: string) {
    const columns = renameColumn(conn.state.columns, key, title);
    if (columns) saveBoardEdit({ columns }, 'inline');
  }

  const cardCounts = $derived(Object.fromEntries(conn.state.columns.map((c) => [c.key, cardsIn(c.key).length])));

  // Tell everyone else when the host removes a column: anything they were
  // typing into it is gone with it.
  let knownColumnKeys: Set<string> | null = null;
  let columnsChangedNotice = $state(false);
  let columnsNoticeHandle: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const keys = new Set(conn.state.columns.map((c) => c.key));
    if (!conn.state.synced) {
      knownColumnKeys = null;
      return;
    }
    const prev = knownColumnKeys;
    knownColumnKeys = keys;
    if (ownColumnEdit) {
      ownColumnEdit = false;
      return;
    }
    if (!prev || ![...prev].some((k) => !keys.has(k))) return;
    columnsChangedNotice = true;
    if (columnsNoticeHandle) clearTimeout(columnsNoticeHandle);
    columnsNoticeHandle = setTimeout(() => (columnsChangedNotice = false), 8000);
  });

  onDestroy(() => {
    if (columnsNoticeHandle) clearTimeout(columnsNoticeHandle);
  });

  // Mirror the board label into this browser's recent-boards list so the
  // homepage can show the human-readable name without re-opening the doc.
  $effect(() => {
    if (!slug) return;
    const labelSnapshot = conn.state.label;
    recordRecentBoard(slug, labelSnapshot ? { label: labelSnapshot } : { label: undefined });
  });

  function formatImportDate(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function setTyping(target: string | null) {
    if (!conn.state.board) return;
    updateAwarenessUser(conn.state.board.provider, { typing: target });
  }

  function cardsIn(col: string): CardData[] {
    return conn.state.cards[col] ?? [];
  }

  function handleAddCard(col: string, text: string) {
    if (!conn.state.board) return;
    addCard(conn.state.board.board, col, text, userId);
  }

  function handleEdit(col: string, cardId: string, text: string) {
    if (!conn.state.board) return;
    editCardText(conn.state.board.board, col, cardId, text);
  }

  function handleDelete(col: string, cardId: string) {
    if (!conn.state.board) return;
    deleteCard(conn.state.board.board, col, cardId);
  }

  function handleVote(col: string, cardId: string) {
    if (!conn.state.board) return;
    toggleVote(conn.state.board.board, col, cardId, userId);
  }

  function handleReact(col: string, cardId: string, emoji: string) {
    if (!conn.state.board) return;
    toggleReaction(conn.state.board.board, col, cardId, emoji, userId);
  }

  function handleAddComment(col: string, cardId: string, text: string) {
    if (!conn.state.board) return;
    addComment(conn.state.board.board, col, cardId, text, userId);
  }

  function handleDeleteComment(col: string, cardId: string, commentId: string) {
    if (!conn.state.board) return;
    deleteComment(conn.state.board.board, col, cardId, commentId);
  }

  function onDragStart(e: DragEvent, cardId: string, fromCol: string) {
    dragCardId = cardId;
    dragFromCol = fromCol;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cardId);
    }
  }

  function onDragEnd() {
    dragCardId = null;
    dragFromCol = null;
    dropTarget = null;
  }

  // Where the dragged card is shown landing. Set from BoardColumn, which knows
  // the geometry; this only allows the drop and records it.
  function onTargetDragOver(e: DragEvent, target: DropTarget) {
    if (!dragCardId || !canReorder) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (!sameDropTarget(dropTarget, target)) dropTarget = target;
  }

  // Over a column but not over anything in it. Keeps the last position while the
  // pointer crosses a gap, so the indicator doesn't flicker.
  function onColumnDragOver(e: DragEvent, col: string) {
    if (!dragCardId || !canReorder) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropTarget?.column !== col) dropTarget = { kind: 'slot', column: col, beforeId: null, sectionId: null };
  }

  function onColumnDrop(e: DragEvent, col: string) {
    e.preventDefault();
    const state = conn.state.board;
    if (!state || !dragCardId || !dragFromCol || !canReorder) {
      onDragEnd();
      return;
    }
    const target = dropTarget ?? { kind: 'slot' as const, column: col, beforeId: null, sectionId: null };
    const source = { column: dragFromCol, cardId: dragCardId, clusterId: laneOfCard(dragCardId) };
    const plan = planDrop(source, target, dragCanGroup);
    switch (plan.kind) {
      case 'reorder':
        moveCard(state.doc, state.board, source.column, source.cardId, plan.column, plan.beforeId);
        break;
      case 'setCluster':
        setCardCluster(state.board, source.column, source.cardId, plan.clusterId);
        break;
      case 'moveLoose':
        state.doc.transact(() => {
          setCardCluster(state.board, source.column, source.cardId, null);
          moveCard(state.doc, state.board, source.column, source.cardId, plan.column, plan.beforeId);
        });
        break;
      case 'newClusterWith':
        state.doc.transact(() => {
          const id = createCluster(state.clusters);
          setCardCluster(state.board, plan.column, plan.cardId, id);
          setCardCluster(state.board, source.column, source.cardId, id);
        });
        break;
    }
    onDragEnd();
  }

  // Keyboard-driven card move: shift+arrow on a focused card moves it
  // within or between columns. Mirrors drag-and-drop without the mouse.
  function findCard(cardId: string): { col: string; index: number } | null {
    for (const col of conn.state.columns) {
      const idx = cardsIn(col.key).findIndex((c: CardData) => c.id === cardId);
      if (idx >= 0) return { col: col.key, index: idx };
    }
    return null;
  }

  function neighborColumn(col: string, direction: -1 | 1): string | null {
    const columns = conn.state.columns;
    const i = columns.findIndex((c) => c.key === col);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= columns.length) return null;
    return columns[j].key;
  }

  function moveFocused(direction: 'up' | 'down' | 'left' | 'right') {
    if (!focusedCardId || !conn.state.board || !canReorder) return;
    const loc = findCard(focusedCardId);
    if (!loc) return;
    const { col } = loc;
    if (direction === 'up' || direction === 'down') {
      const target = reorderTarget(sectionOf(layout, col, focusedCardId), focusedCardId, direction === 'up' ? -1 : 1);
      if (!target) return;
      moveCard(conn.state.board.doc, conn.state.board.board, col, focusedCardId, col, target.beforeId);
    } else {
      const dir = direction === 'left' ? -1 : 1;
      const target = neighborColumn(col, dir);
      if (!target) return;
      moveCard(conn.state.board.doc, conn.state.board.board, col, focusedCardId, target, null);
    }
  }

  function onCardKeydown(e: KeyboardEvent, cardId: string) {
    if (!e.shiftKey) return;
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowUp':
        focusedCardId = cardId;
        moveFocused('up');
        break;
      case 'ArrowDown':
        focusedCardId = cardId;
        moveFocused('down');
        break;
      case 'ArrowLeft':
        focusedCardId = cardId;
        moveFocused('left');
        break;
      case 'ArrowRight':
        focusedCardId = cardId;
        moveFocused('right');
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  function leadSetTimer() {
    if (!conn.state.board || !isLead) return;
    const mins = parseFloat(timerInputMin);
    if (Number.isNaN(mins) || mins <= 0) return;
    setTimerDuration(conn.state.board.timer, Math.round(mins * 60));
  }

  function leadStart() {
    if (!conn.state.board || !isLead) return;
    const timer = conn.state.board.timer;
    const state = readTimer(timer);
    const isResumable = state.paused && state.pausedRemaining !== null && state.pausedRemaining > 0;
    if (state.durationSec <= 0 && !isResumable) {
      const mins = parseFloat(timerInputMin);
      if (!Number.isNaN(mins) && mins > 0) {
        setTimerDuration(timer, Math.round(mins * 60));
      }
    }
    startTimer(timer);
  }

  function leadPause() {
    if (!conn.state.board || !isLead) return;
    pauseTimer(conn.state.board.timer);
  }

  function leadReset() {
    if (!conn.state.board || !isLead) return;
    resetTimer(conn.state.board.timer);
  }

  function advancePhase() {
    if (!conn.state.board || !isLead) return;
    const next = nextPhase(conn.state.phase, phases);
    if (next !== conn.state.phase) setPhase(conn.state.board.phase, next);
  }

  function previousPhase() {
    if (!conn.state.board || !isLead) return;
    const prev = prevPhase(conn.state.phase, phases);
    if (prev !== conn.state.phase) setPhase(conn.state.board.phase, prev);
  }

  const phases = $derived(phasesFor(conn.state.columns));
  const phaseIndex = $derived(phases.indexOf(conn.state.phase));
  const isLastPhase = $derived(phaseIndex === phases.length - 1);
  const isFirstPhase = $derived(phaseIndex === 0);
  const canVote = $derived(canVoteInPhase(conn.state.phase));

  // Display-only: never rewrites the underlying Y.Array, so this adds no new
  // CRDT conflict surface. Active once the lead moves into Discuss (and
  // stays active through Actions) — not during Vote itself, so the card
  // someone's about to vote on doesn't jump position mid-cast. Lead can also
  // turn it off entirely via the autoSort meta flag (on by default). Ties
  // keep original array position via stable sort. Manual drag-to-reorder is
  // disabled whenever the sort is actually active, since a drag would just
  // get overridden by the next sort on re-render.
  const sortActive = $derived(canSortByVotes(conn.state.phase) && conn.state.settings.autoSort);
  const canReorder = $derived(!sortActive);

  const layout = $derived(
    layoutBoard(conn.state.columns, conn.state.cards, conn.state.clusters, {
      showClusters: clustersVisible(conn.state.phase, ended),
      sortByVotes: sortActive
    })
  );
  const canCluster = $derived(canEditClusters(conn.state.phase, ended));
  const canMergeClusters = $derived(canCluster && effectiveLead);
  const dragCanGroup = $derived(canCluster && dragFromCol !== null && dragFromCol !== ACTIONS_COLUMN_KEY);
  function laneOfCard(cardId: string): string | null {
    return layout.lanes.find((lane) => Object.values(lane.cards).some((list) => list.some((c) => c.id === cardId)))?.cluster.id ?? null;
  }
  const dragIsGrouped = $derived(dragCardId !== null && laneOfCard(dragCardId) !== null);
  function mergeTitle(lane: ClusterLane): string {
    return conn.state.columns.find((c) => (lane.cards[c.key]?.length ?? 0) > 0)?.title ?? '';
  }
  const clusterActions: ClusterActions = {
    join(column, cardId, clusterId) {
      if (conn.state.board) setCardCluster(conn.state.board.board, column, cardId, clusterId);
    },
    create(column, cardId, label) {
      const state = conn.state.board;
      if (!state) return;
      state.doc.transact(() => {
        setCardCluster(state.board, column, cardId, createCluster(state.clusters, label));
      });
    },
    leave(column, cardId) {
      if (conn.state.board) setCardCluster(conn.state.board.board, column, cardId, null);
    },
    rename(clusterId, label) {
      if (conn.state.board) renameCluster(conn.state.board.clusters, clusterId, label);
    },
    dissolve(clusterId) {
      if (conn.state.board) dissolveCluster(conn.state.board.doc, conn.state.board.board, clusterId);
    },
    merge(clusterId) {
      if (conn.state.board) mergeCluster(conn.state.board.doc, conn.state.board.board, clusterId, conn.state.columns.map((c) => c.key));
    }
  };

  function downloadCSV(source: 'board' | 'ended' = 'board') {
    track({ name: 'board_export', params: { format: 'csv', source } });
    // The BOM makes Excel read the file as UTF-8 so emoji reactions survive.
    const csv = '\uFEFF' + exportCSV(conn.state.cards, conn.state.columns, conn.state.clusters);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${exportFileStem(conn.state.label)}.csv`);
  }

  function downloadJSON(source: 'board' | 'end' | 'ended' = 'board') {
    track({ name: 'board_export', params: { format: 'board_file', source } });
    downloadBoardFile(
      exportBoardFile({
        label: conn.state.label,
        anonymous: conn.state.settings.anonymous,
        phase: conn.state.phase,
        autoSort: conn.state.settings.autoSort,
        hideCards: conn.state.settings.hideCards,
        columns: conn.state.columns,
        clusters: conn.state.clusters,
        cards: conn.state.cards,
        namesMap: conn.state.namesMap
      })
    );
  }

  const cardCount = $derived(conn.state.columns.reduce((n, col) => n + cardsIn(col.key).length, 0));

  function startEndBoard() {
    if (!isLead) return;
    endConfirm = true;
  }

  function cancelEndBoard() {
    endConfirm = false;
  }

  let archiving = $state<boolean>(false);
  let archiveError = $state<string>('');

  async function confirmEndBoard(opts: { exportFirst: boolean }) {
    if (!conn.state.board || !effectiveLead) {
      endConfirm = false;
      return;
    }
    if (opts.exportFirst) downloadJSON('end');
    archiveError = '';
    archiving = true;
    // Broadcast the end + a motivational message to every connected client
    // before the archive REST call flips the room read-only server-side —
    // once that happens the server silently drops further doc writes (see
    // main.rs `room.is_ended()`), so this has to land first.
    const { doc, meta } = conn.state.board;
    doc.transact(() => {
      setBoardEnded(meta, pickMotivationalMessage());
    });
    const archiveClusters = clustersInUse(conn.state.clusters, conn.state.cards, conn.state.columns);
    try {
      await endBoard(
        slug,
        {
          label: conn.state.label,
          cards: Object.fromEntries(conn.state.columns.map((c) => [c.key, cardsIn(c.key)])),
          names: conn.state.settings.anonymous ? {} : conn.state.namesMap,
          anonymous: conn.state.settings.anonymous,
          phase: conn.state.phase,
          autoSort: conn.state.settings.autoSort,
          hideCards: conn.state.settings.hideCards,
          // Classic boards send no list, so their archives look as they always have.
          columns: sameColumns(conn.state.columns, DEFAULT_COLUMNS) ? undefined : conn.state.columns,
          // Likewise for boards with no groups.
          clusters: archiveClusters.length ? archiveClusters : undefined
        },
        { hostKey, leadToken }
      );
    } catch (e) {
      // Archive failed — the retro is still open. Revert the broadcast so a
      // future joiner (or a still-connected client) doesn't see a stale
      // "ended" signal for a board that's actually still live.
      doc.transact(() => {
        meta.delete('endedAt');
        meta.delete('endedMessage');
      });
      archiveError = 'Ending failed. The retro is still open — try again.';
      archiving = false;
      return;
    }
    archiving = false;
    // Archived + frozen server-side. Flip to read-only in place — the board
    // stays viewable; we don't wipe it.
    ended = true;
    endConfirm = false;
  }

  // Seamless "next retro": spin up a brand-new board (never reuse this slug),
  // become its host, and navigate there. Carries the label forward and, unless
  // the host unticks it, this retro's action items so the team can review
  // them. They arrive through the import handoff as fresh cards (no votes or
  // reactions; comments kept) on a new anonymous board, same as before.
  // Boards without an Action items column have nothing to carry.
  const actionCount = $derived(hasActionsColumn(conn.state.columns) ? cardsIn(ACTIONS_COLUMN_KEY).length : 0);

  function carryOverFile(label: string) {
    const actions = cardsIn(ACTIONS_COLUMN_KEY).slice(0, MAX_IMPORT_CARDS).map((card) => ({
      ...card,
      votes: [],
      reactions: {},
      comments: card.comments.slice(0, MAX_IMPORT_COMMENTS_PER_CARD)
    }));
    return exportBoardFile({
      label,
      anonymous: true,
      phase: 'brainstorm',
      autoSort: conn.state.settings.autoSort,
      hideCards: conn.state.settings.hideCards,
      // The next retro keeps this board's columns and settings.
      columns: conn.state.columns,
      cards: { [ACTIONS_COLUMN_KEY]: actions },
      namesMap: {}
    });
  }

  async function startNextRetro() {
    if (startingNext) return;
    startingNext = true;
    try {
      const base = conn.state.label ? conn.state.label.trim().slice(0, 60) : '';
      const body = slugifyLabel(base);
      const wanted = body ? `${body}-${newSlug(3)}` : newSlug();
      let res = await createBoard(wanted, base).catch(() => null);
      if (!res) res = await createBoard(newSlug(), base);
      setHostKey(res.slug, res.hostKey);
      if (base) recordRecentBoard(res.slug, { label: base });
      const carried = carryActions ? actionCount : 0;
      const seeded = carried > 0 && setPendingSeed(res.slug, carryOverFile(base), { kind: 'carryover', from: base });
      if (!seeded) {
        setPendingSeed(res.slug, newBoardSeed({ label: base, anonymous: true, hideCards: conn.state.settings.hideCards, columns: conn.state.columns }), { kind: 'new' });
      }
      track({ name: 'next_retro', params: { carried_actions: carried } });
      goto(`/board/${res.slug}`);
    } catch {
      startingNext = false;
    }
  }
</script>

<svelte:head>
  <title>{conn.state.label ? `${conn.state.label} — Fast Retro` : 'Fast Retro'}</title>
</svelte:head>

{#if promptingName}
  <NamePrompt
    bind:nameInput
    {themePref}
    {darkMode}
    onCommit={commitName}
    onCycleTheme={cycleTheme}
  />
{:else}
  <div class="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
    <BoardHeader
      isLead={effectiveLead}
      connected={conn.state.connected}
      {ended}
      label={conn.state.label}
      {slug}
      timerState={conn.state.timerState}
      {remainingSec}
      {timerRunning}
      {timerExpired}
      bind:timerInputMin
      {themePref}
      {darkMode}
      presence={presenceDisambiguated}
      currentClientId={conn.state.currentClientId}
      userName={userName || 'Guest'}
      settings={conn.state.settings}
      onSetTimer={leadSetTimer}
      onStartTimer={leadStart}
      onPauseTimer={leadPause}
      onResetTimer={leadReset}
      onExportCSV={() => downloadCSV('board')}
      onExportJSON={() => downloadJSON('board')}
      onEndBoard={startEndBoard}
      onCycleTheme={cycleTheme}
      onChangeName={changeName}
      onChangeLabel={changeLabel}
      onToggleSetting={toggleSetting}
      onEditBoard={openEditBoard}
    />

    <div
      class="border-b border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40"
      aria-label="Retro phase"
    >
      <div class="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 flex items-center gap-2 flex-wrap text-xs">
        <span class="text-slate-500 dark:text-slate-400 hidden sm:inline">Phase</span>
        <div class="flex items-center gap-1" role="list" aria-label="Phases">
          {#each phases as p, i (p)}
            {@const active = p === conn.state.phase}
            {@const done = i < phaseIndex}
            <span
              role="listitem"
              aria-current={active ? 'step' : undefined}
              class="inline-flex items-center px-2 py-0.5 rounded-full border tabular-nums
                {active
                  ? 'bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100 font-semibold'
                  : done
                  ? 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                  : 'bg-transparent border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-500'}"
            >
              <span class="hidden sm:inline mr-1 opacity-70">{i + 1}</span>{PHASE_LABEL[p]}
            </span>
          {/each}
        </div>
        <span class="text-slate-500 dark:text-slate-400 truncate min-w-0">— {PHASE_HINT[conn.state.phase]}</span>
        {#if conn.state.imported}
          {@const imp = conn.state.imported}
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 whitespace-nowrap"
            data-testid="imported-note"
            title={imp.origin.kind === 'file'
              ? 'Cards, votes, reactions and authors came from an uploaded file, not from people acting on this board.'
              : 'Action items brought over from the previous retro.'}
          >
            {#if imp.origin.kind === 'file'}
              <FileUp size={12} aria-hidden="true" />
              Imported from a file · {formatImportDate(imp.at)}
            {:else}
              <History size={12} aria-hidden="true" />
              {imp.origin.from ? `Action items from “${imp.origin.from}”` : 'Action items from last retro'}
            {/if}
          </span>
        {/if}
        {#if effectiveLead}
          <div class="ml-auto flex items-center gap-1.5">
            {#if !isFirstPhase}
              <button
                class="btn text-xs px-2.5 py-1 min-h-[32px]"
                onclick={previousPhase}
                aria-label={`Go back to ${PHASE_LABEL[phases[phaseIndex - 1]]} phase`}
              >
                <ArrowLeft size={13} aria-hidden="true" />
                <span class="hidden sm:inline">Previous</span>
              </button>
            {/if}
            {#if !isLastPhase}
              <button
                class="btn text-xs px-2.5 py-1 min-h-[32px]"
                onclick={advancePhase}
                aria-label={`Advance to ${PHASE_LABEL[phases[phaseIndex + 1]]} phase`}
              >
                Next phase
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if ended}
      <div
        class="border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200"
        role="status"
        aria-live="polite"
      >
        <div class="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3 flex-wrap">
          <div class="flex-1 min-w-[200px]">
            <div class="font-semibold text-sm">This retro has ended</div>
            <div class="text-xs opacity-80">
              It's archived and read-only now. Anyone with the link can still export it. {isLead ? 'Start a fresh one for your next session.' : 'Ask your host to start a new one.'}
            </div>
          </div>
          <ExportMenu
            onSaveBoardFile={() => downloadJSON('ended')}
            onExportCSV={() => downloadCSV('ended')}
            disabled={!conn.state.synced}
            align="right"
          />
          {#if isLead}
            {#if actionCount > 0}
              <label class="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input type="checkbox" bind:checked={carryActions} class="rounded" disabled={startingNext} />
                Bring {actionCount} action item{actionCount === 1 ? '' : 's'}
              </label>
            {/if}
            <button
              class="inline-flex items-center gap-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md text-xs px-3 py-2 min-h-[36px] font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
              disabled={startingNext}
              onclick={startNextRetro}
            >
              {startingNext ? 'Starting…' : 'Start next retro'}
            </button>
          {/if}
          <a href="/" class="btn-ghost text-xs px-3 py-2 min-h-[36px]">Home</a>
        </div>
      </div>
    {/if}

    {#if isHidingCards({ hideCards: conn.state.settings.hideCards, phase: conn.state.phase, ended })}
      <div
        class="border-b border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200"
        role="status"
        data-testid="hidden-cards-banner"
      >
        <div class="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 text-xs flex items-center gap-2">
          <Blinds size={13} aria-hidden="true" />
          <span>Cards are hidden until the Group phase. You only see your own.</span>
        </div>
      </div>
    {/if}

    {#if timerJustExpired}
      <div
        class="border-b border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-100 motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-200"
        role="status"
        aria-live="polite"
      >
        <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2 text-sm flex items-center gap-2">
          <span aria-hidden="true">⏰</span>
          <span class="font-medium">Time's up</span>
          <span class="opacity-80 hidden sm:inline">— wrap up your last point.</span>
        </div>
      </div>
    {/if}

    {#if showDisconnectBanner}
      <div
        class="border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-100 motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-200"
        role="alert"
        aria-live="assertive"
      >
        <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2 text-sm flex items-center gap-2">
          <span aria-hidden="true">⚠</span>
          <span class="font-medium">Reconnecting…</span>
          <span class="opacity-80 hidden sm:inline">— your edits are queued locally and will sync when the board comes back.</span>
        </div>
      </div>
    {/if}

    <!-- Off-screen announcer for timer state transitions (start/pause/reset/expire). -->
    <div class="sr-only" aria-live="polite" role="status">{timerAnnouncement}</div>

    {#if endConfirm}
      <div
        class="border-b border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-100"
        role="alertdialog"
        aria-labelledby="end-board-heading"
      >
        <div class="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3 flex-wrap">
          <div class="flex-1 min-w-[200px]">
            <div id="end-board-heading" class="font-semibold text-sm">End this retro?</div>
            <div class="text-xs opacity-80">
              Saves a snapshot to your archives and makes the board read-only for everyone.
              You can start a fresh retro right after.
            </div>
            {#if archiveError}
              <div class="text-xs mt-1 font-medium text-rose-900 dark:text-rose-100">{archiveError}</div>
            {/if}
          </div>
          {#if cardCount > 0}
            <button
              class="btn text-xs px-3 py-1.5"
              disabled={archiving}
              onclick={() => confirmEndBoard({ exportFirst: true })}
            >
              <Download size={14} aria-hidden="true" />
              Save board file &amp; end
            </button>
          {/if}
          <button
            class="btn-danger text-xs px-3 py-1.5"
            disabled={archiving}
            onclick={() => confirmEndBoard({ exportFirst: false })}
          >
            {archiving ? 'Saving…' : 'Archive & end'}
          </button>
          <button class="btn-ghost text-xs px-3 py-1.5" disabled={archiving} onclick={cancelEndBoard}>Cancel</button>
        </div>
      </div>
    {/if}

    <main
      class="flex-1 w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 {isWideBoard(conn.state.columns.length) ? 'max-w-none' : 'max-w-7xl'}"
    >
      <div
        class={boardGridClass(conn.state.columns.length)}
        style="--board-cols: {conn.state.columns.length}"
        data-testid="board-columns"
      >
        {#each conn.state.columns as col (col.key)}
          <BoardColumn
            column={col}
            cards={layout.loose[col.key] ?? []}
            lanes={layout.lanes}
            cardCount={cardsIn(col.key).length}
            {canCluster}
            canMerge={canMergeClusters}
            {mergeTitle}
            {clusterActions}
            canAdd={canAddCardInColumn(col, conn.state.phase) && !ended}
            phase={conn.state.phase}
            {userId}
            {userName}
            isLead={effectiveLead}
            readOnly={ended}
            {canVote}
            anonymous={conn.state.settings.anonymous}
            namesMap={namesMapDisambiguated}
            {canReorder}
            hideCards={conn.state.settings.hideCards}
            {dragCardId}
            {dragCanGroup}
            {dragIsGrouped}
            {dropTarget}
            {typingByCard}
            {reducedMotion}
            {coarsePointer}
            onAddCard={(text) => handleAddCard(col.key, text)}
            onTyping={setTyping}
            onEdit={(id, text) => handleEdit(col.key, id, text)}
            onDelete={(id) => handleDelete(col.key, id)}
            onToggleVote={(id) => handleVote(col.key, id)}
            onToggleReaction={(id, e) => handleReact(col.key, id, e)}
            onAddComment={(id, t) => handleAddComment(col.key, id, t)}
            onDeleteComment={(id, cid) => handleDeleteComment(col.key, id, cid)}
            {onCardKeydown}
            onFocusCard={(id) => (focusedCardId = id)}
            {onDragStart}
            {onDragEnd}
            {onTargetDragOver}
            onColumnDragOver={(e) => onColumnDragOver(e, col.key)}
            onColumnDrop={(e) => onColumnDrop(e, col.key)}
            onRename={(t) => renameColumnInline(col.key, t)}
          />
        {/each}
      </div>
    </main>

    <footer class="text-center text-xs text-slate-400 dark:text-slate-500 py-4">
      Joined as <span class="font-medium text-slate-500 dark:text-slate-400">{userName}</span>
      <span aria-hidden="true">·</span>
      <a
        href={isLead ? '/docs?role=lead' : '/docs?role=participant'}
        class="hover:text-slate-600 dark:hover:text-slate-300 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
      >
        User guide
      </a>
    </footer>
  </div>

  {#if showOnboarding}
    <Onboarding onDismiss={dismissOnboarding} />
  {/if}

  {#if editingBoard && effectiveLead}
    <EditBoardModal
      label={conn.state.label}
      columns={conn.state.columns}
      settings={conn.state.settings}
      {cardCounts}
      onClose={() => (editingBoard = false)}
      onSave={(edit) => saveBoardEdit(edit, 'dialog')}
    />
  {/if}

  {#if columnsChangedNotice}
    <div
      class="fixed inset-x-0 top-16 z-30 flex justify-center px-3 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div
        class="pointer-events-auto flex items-center gap-2.5 max-w-sm w-full sm:w-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg px-4 py-2.5 text-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        data-testid="columns-changed-notice"
      >
        <span class="flex-1">The host changed the columns.</span>
        <button
          class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
          onclick={() => (columnsChangedNotice = false)}
          aria-label="Dismiss"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  {/if}

  {#if showEndCelebration}
    <div
      class="fixed inset-x-0 bottom-4 sm:bottom-6 z-30 flex justify-center px-3 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div
        class="pointer-events-auto flex items-center gap-2.5 max-w-sm w-full sm:w-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg px-4 py-3 motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in motion-safe:duration-300"
        data-testid="end-celebration-toast"
      >
        <PartyPopper size={18} class="text-amber-500 shrink-0" aria-hidden="true" />
        <span class="text-sm font-medium text-slate-800 dark:text-slate-100 flex-1">
          {conn.state.endedMessage || 'Great retro! See you next sprint.'}
        </span>
        <button
          class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
          onclick={dismissEndCelebration}
          aria-label="Dismiss"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  {/if}
{/if}
