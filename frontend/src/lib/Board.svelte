<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Card from './Card.svelte';
  import BoardHeader from './BoardHeader.svelte';
  import NamePrompt from './NamePrompt.svelte';
  import Onboarding from './Onboarding.svelte';
  import {
    addCard,
    editCardText,
    deleteCard,
    resetBoard,
    toggleVote,
    toggleReaction,
    addComment,
    deleteComment,
    moveCard,
    setBoardLabel,
    setBoardAnonymous
  } from './yboard';
  import { recordRecentBoard, consumePendingLabel } from './boards';
  import {
    setTimerDuration,
    startTimer,
    pauseTimer,
    resetTimer,
    computeTimerRemaining
  } from './timer';
  import { exportCSV } from './csv';
  import { getOrCreateUserId, setDisplayName } from './identity';
  import { getName, setName, getTheme, setTheme, getOnboarded, setOnboarded, type ThemePref } from './storage';
  import { updateAwarenessUser } from './awareness';
  import { useBoardConnection } from './useBoardConnection.svelte';
  import { COLUMNS, COLUMN_EMPTY_HINT, COLUMN_PLACEHOLDER, type CardData, type ColumnKey } from './types';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { disambiguateNames, disambiguateNamesMap } from './identity';
  import { Download, ArrowLeft, ArrowRight } from 'lucide-svelte';
  import {
    PHASES,
    PHASE_LABEL,
    PHASE_HINT,
    nextPhase,
    prevPhase,
    setPhase,
    canAddCardInColumn,
    canVoteInPhase
  } from './phase';

  let { isLead = false, slug, leadToken = '' } = $props<{ isLead?: boolean; slug: string; leadToken?: string }>();

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
  let dragFromCol = $state<ColumnKey | null>(null);
  let dragOverCol = $state<ColumnKey | null>(null);
  let dragOverIndex = $state<number>(-1);
  let coarsePointer = $state<boolean>(false);
  let reducedMotion = $state<boolean>(false);
  let prevTimerExpired = $state<boolean>(false);
  let timerJustExpired = $state<boolean>(false);
  let timerExpiredHandle: ReturnType<typeof setTimeout> | null = null;

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

  const typingByCard = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const p of presenceDisambiguated) {
      if (p.typing && p.clientId !== conn.state.currentClientId) {
        const list = map.get(p.typing) ?? [];
        list.push(p.name);
        map.set(p.typing, list);
      }
    }
    return map;
  });

  let drafts = $state<Record<ColumnKey, string>>({
    wentWell: '',
    toImprove: '',
    actions: ''
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
      conn.start({ userId, userName, isLead, slug });
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
    conn.start({ userId, userName, isLead, slug });
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

  function toggleAnonymous() {
    if (!conn.state.board || !isLead) return;
    setBoardAnonymous(conn.state.board.meta, !conn.state.anonymous);
  }

  // Mirror the board label into this browser's recent-boards list so the
  // homepage can show the human-readable name without re-opening the doc.
  $effect(() => {
    if (!slug) return;
    const labelSnapshot = conn.state.label;
    recordRecentBoard(slug, labelSnapshot ? { label: labelSnapshot } : { label: undefined });
  });

  // If the host arrived from the "Start a new retro" modal with a pre-chosen
  // name, apply it once the Yjs doc is ready and the board is still unnamed.
  // Guarded on isLead because only the host can write the meta map.
  let pendingApplied = false;
  $effect(() => {
    if (pendingApplied) return;
    if (!isLead || !conn.state.board) return;
    if (conn.state.label) {
      pendingApplied = true;
      return;
    }
    const pending = consumePendingLabel(slug);
    if (pending) {
      setBoardLabel(conn.state.board.meta, pending);
    }
    pendingApplied = true;
  });

  function setTyping(target: string | null) {
    if (!conn.state.board) return;
    updateAwarenessUser(conn.state.board.provider, { typing: target });
  }

  function submitNew(col: ColumnKey) {
    const text = drafts[col].trim();
    if (!text || !conn.state.board) return;
    addCard(conn.state.board.board, col, text, userId);
    drafts[col] = '';
    setTyping(null);
  }

  function onNewKey(e: KeyboardEvent, col: ColumnKey) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitNew(col);
    }
  }

  function handleEdit(col: ColumnKey, cardId: string, text: string) {
    if (!conn.state.board) return;
    editCardText(conn.state.board.board, col, cardId, text);
  }

  function handleDelete(col: ColumnKey, cardId: string) {
    if (!conn.state.board) return;
    deleteCard(conn.state.board.board, col, cardId);
  }

  function handleVote(col: ColumnKey, cardId: string) {
    if (!conn.state.board) return;
    toggleVote(conn.state.board.board, col, cardId, userId);
  }

  function handleReact(col: ColumnKey, cardId: string, emoji: string) {
    if (!conn.state.board) return;
    toggleReaction(conn.state.board.board, col, cardId, emoji, userId);
  }

  function handleAddComment(col: ColumnKey, cardId: string, text: string) {
    if (!conn.state.board) return;
    addComment(conn.state.board.board, col, cardId, text, userId);
  }

  function handleDeleteComment(col: ColumnKey, cardId: string, commentId: string) {
    if (!conn.state.board) return;
    deleteComment(conn.state.board.board, col, cardId, commentId);
  }

  function onDragStart(e: DragEvent, cardId: string, fromCol: ColumnKey) {
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
    dragOverCol = null;
    dragOverIndex = -1;
  }

  function onCardSlotDragOver(e: DragEvent, col: ColumnKey, index: number) {
    if (!dragCardId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverCol = col;
    dragOverIndex = index;
  }

  function onColumnDragOver(e: DragEvent, col: ColumnKey) {
    if (!dragCardId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragOverCol !== col) {
      dragOverCol = col;
      dragOverIndex = conn.state.cards[col].length;
    }
  }

  function onColumnDrop(e: DragEvent, col: ColumnKey) {
    e.preventDefault();
    if (!conn.state.board || !dragCardId || !dragFromCol) {
      onDragEnd();
      return;
    }
    const toIndex = dragOverIndex < 0 ? conn.state.cards[col].length : dragOverIndex;
    moveCard(
      conn.state.board.doc,
      conn.state.board.board,
      dragFromCol,
      dragCardId,
      col,
      toIndex
    );
    onDragEnd();
  }

  // Keyboard-driven card move: shift+arrow on a focused card moves it
  // within or between columns. Mirrors drag-and-drop without the mouse.
  function findCard(cardId: string): { col: ColumnKey; index: number } | null {
    for (const col of COLUMNS) {
      const idx = conn.state.cards[col.key].findIndex((c: CardData) => c.id === cardId);
      if (idx >= 0) return { col: col.key, index: idx };
    }
    return null;
  }

  function neighborColumn(col: ColumnKey, direction: -1 | 1): ColumnKey | null {
    const i = COLUMNS.findIndex((c) => c.key === col);
    const j = i + direction;
    if (j < 0 || j >= COLUMNS.length) return null;
    return COLUMNS[j].key;
  }

  function moveFocused(direction: 'up' | 'down' | 'left' | 'right') {
    if (!focusedCardId || !conn.state.board) return;
    const loc = findCard(focusedCardId);
    if (!loc) return;
    const { col, index } = loc;
    if (direction === 'up' || direction === 'down') {
      const delta = direction === 'up' ? -1 : 1;
      const newIdx = Math.max(0, Math.min(conn.state.cards[col].length - 1, index + delta));
      if (newIdx === index) return;
      // moveCard treats target index relative to current sequence; when
      // moving within a column, pass the target slot index.
      moveCard(conn.state.board.doc, conn.state.board.board, col, focusedCardId, col, newIdx);
    } else {
      const dir = direction === 'left' ? -1 : 1;
      const target = neighborColumn(col, dir);
      if (!target) return;
      moveCard(
        conn.state.board.doc,
        conn.state.board.board,
        col,
        focusedCardId,
        target,
        conn.state.cards[target].length
      );
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
    startTimer(conn.state.board.timer);
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
    const next = nextPhase(conn.state.phase);
    if (next !== conn.state.phase) setPhase(conn.state.board.phase, next);
  }

  function previousPhase() {
    if (!conn.state.board || !isLead) return;
    const prev = prevPhase(conn.state.phase);
    if (prev !== conn.state.phase) setPhase(conn.state.board.phase, prev);
  }

  const phaseIndex = $derived(PHASES.indexOf(conn.state.phase));
  const isLastPhase = $derived(phaseIndex === PHASES.length - 1);
  const isFirstPhase = $derived(phaseIndex === 0);
  const canVote = $derived(canVoteInPhase(conn.state.phase));

  function downloadCSV() {
    const csv = exportCSV(conn.state.cards);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `retro-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const cardCount = $derived(
    conn.state.cards.wentWell.length +
      conn.state.cards.toImprove.length +
      conn.state.cards.actions.length
  );

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
    if (!conn.state.board || !isLead) {
      endConfirm = false;
      return;
    }
    if (opts.exportFirst) downloadCSV();
    archiveError = '';
    if (leadToken) {
      archiving = true;
      try {
        const body = {
          label: conn.state.label,
          cards: conn.state.cards,
          names: conn.state.namesMap
        };
        const r = await fetch(`/api/boards/${encodeURIComponent(slug)}/archive`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${leadToken}`
          },
          body: JSON.stringify(body)
        });
        if (!r.ok) {
          archiveError = `Archive failed (${r.status}). Board not cleared.`;
          archiving = false;
          return;
        }
      } catch (e) {
        archiveError = 'Network error while archiving. Board not cleared.';
        archiving = false;
        return;
      }
      archiving = false;
    }
    resetBoard(conn.state.board.doc, conn.state.board.board, conn.state.board.timer);
    endConfirm = false;
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
      {isLead}
      connected={conn.state.connected}
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
      {userName}
      anonymous={conn.state.anonymous}
      onSetTimer={leadSetTimer}
      onStartTimer={leadStart}
      onPauseTimer={leadPause}
      onResetTimer={leadReset}
      onExportCSV={downloadCSV}
      onEndBoard={startEndBoard}
      onCycleTheme={cycleTheme}
      onChangeName={changeName}
      onChangeLabel={changeLabel}
      onToggleAnonymous={toggleAnonymous}
    />

    <div
      class="border-b border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40"
      aria-label="Retro phase"
    >
      <div class="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 flex items-center gap-2 flex-wrap text-xs">
        <span class="text-slate-500 dark:text-slate-400 hidden sm:inline">Phase</span>
        <div class="flex items-center gap-1" role="list" aria-label="Phases">
          {#each PHASES as p, i (p)}
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
        {#if isLead}
          <div class="ml-auto flex items-center gap-1.5">
            {#if !isFirstPhase}
              <button
                class="btn text-xs px-2.5 py-1 min-h-[32px]"
                onclick={previousPhase}
                aria-label={`Go back to ${PHASE_LABEL[PHASES[phaseIndex - 1]]} phase`}
              >
                <ArrowLeft size={13} aria-hidden="true" />
                <span class="hidden sm:inline">Previous</span>
              </button>
            {/if}
            {#if !isLastPhase}
              <button
                class="btn text-xs px-2.5 py-1 min-h-[32px]"
                onclick={advancePhase}
                aria-label={`Advance to ${PHASE_LABEL[PHASES[phaseIndex + 1]]} phase`}
              >
                Next phase
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>

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
              {#if leadToken}
                Saves a snapshot you can revisit from your archives, then clears the board for everyone.
              {:else}
                This clears all cards, comments, and the timer for everyone. This can't be undone.
              {/if}
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
              Export CSV &amp; clear
            </button>
          {/if}
          <button
            class="btn-danger text-xs px-3 py-1.5"
            disabled={archiving}
            onclick={() => confirmEndBoard({ exportFirst: false })}
          >
            {archiving ? 'Saving…' : leadToken ? 'Archive & clear' : 'Clear board'}
          </button>
          <button class="btn-ghost text-xs px-3 py-1.5" disabled={archiving} onclick={cancelEndBoard}>Cancel</button>
        </div>
      </div>
    {/if}

    <main class="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {#each COLUMNS as col (col.key)}
          {@const typingNew = typingByCard.get(`new-${col.key}`) ?? []}
          {@const colCards = conn.state.cards[col.key]}
          {@const canAdd = canAddCardInColumn(col.key, conn.state.phase)}
          <section
            class="border rounded-xl shadow-sm flex flex-col {col.accent}"
            role="list"
            aria-label={col.title}
            ondragover={(e) => onColumnDragOver(e, col.key)}
            ondrop={(e) => onColumnDrop(e, col.key)}
          >
            <header class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between rounded-t-xl {col.header}">
              <div class="flex items-center gap-2">
                <span class="w-1.5 h-5 rounded-full {col.dot}" aria-hidden="true"></span>
                <h2 class="font-semibold tracking-tight text-slate-800 dark:text-slate-100">{col.title}</h2>
              </div>
              <span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{colCards.length}</span>
            </header>
            <div class="p-3 flex-1 space-y-2 min-h-[96px]">
              {#if colCards.length === 0}
                <div class="text-xs text-slate-400 dark:text-slate-500 italic px-1 py-2 select-none">
                  {COLUMN_EMPTY_HINT[col.key]}
                </div>
              {/if}
              {#each colCards as card, i (card.id)}
                {@const typers = typingByCard.get(card.id) ?? []}
                <div
                  class="relative"
                  role="listitem"
                  ondragover={(e) => onCardSlotDragOver(e, col.key, i)}
                  in:fly|global={{ y: 6, duration: reducedMotion ? 0 : 180, easing: cubicOut }}
                >
                  {#if dragOverCol === col.key && dragOverIndex === i && dragCardId !== card.id}
                    <div class="h-1 -mt-1 mb-1 bg-sky-400 rounded-full motion-safe:animate-pulse"></div>
                  {/if}
                  <Card
                    {card}
                    column={col.key}
                    {userId}
                    {userName}
                    {isLead}
                    {canVote}
                    anonymous={conn.state.anonymous}
                    namesMap={namesMapDisambiguated}
                    onEdit={(id, text) => handleEdit(col.key, id, text)}
                    onDelete={(id) => handleDelete(col.key, id)}
                    onToggleVote={(id) => handleVote(col.key, id)}
                    onToggleReaction={(id, e) => handleReact(col.key, id, e)}
                    onAddComment={(id, t) => handleAddComment(col.key, id, t)}
                    onDeleteComment={(id, cid) => handleDeleteComment(col.key, id, cid)}
                    onTypingComment={(target) => setTyping(target)}
                    onKeydown={(e) => onCardKeydown(e, card.id)}
                    onFocusCard={() => (focusedCardId = card.id)}
                    {onDragStart}
                    {onDragEnd}
                  />
                  {#if typers.length > 0}
                    <div
                      class="text-[11px] text-slate-500 dark:text-slate-400 italic pl-1 mt-0.5"
                      aria-live="polite"
                    >
                      {typers.join(', ')} typing…
                    </div>
                  {/if}
                </div>
              {/each}
              {#if dragOverCol === col.key && dragOverIndex >= colCards.length}
                <div class="h-1 bg-sky-400 rounded-full motion-safe:animate-pulse"></div>
              {/if}
            </div>
            <footer class="p-3 border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 rounded-b-xl">
              {#if canAdd}
                <textarea
                  bind:value={drafts[col.key]}
                  onkeydown={(e) => onNewKey(e, col.key)}
                  onfocus={() => setTyping(`new-${col.key}`)}
                  onblur={() => setTyping(null)}
                  placeholder={COLUMN_PLACEHOLDER[col.key]}
                  rows="2"
                  aria-label={`Add a card to ${col.title}`}
                  class="input w-full resize-none px-2.5 py-2 text-sm leading-snug"
                ></textarea>
                {#if typingNew.length > 0}
                  <div
                    class="text-[11px] text-slate-500 dark:text-slate-400 italic pl-1 mt-0.5"
                    aria-live="polite"
                  >
                    {typingNew.join(', ')} typing…
                  </div>
                {/if}
                <div class="mt-2 flex items-center gap-2">
                  <button
                    onclick={() => submitNew(col.key)}
                    disabled={!drafts[col.key].trim()}
                    class="flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm rounded-md py-2 font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    Add card
                  </button>
                  {#if !coarsePointer}
                    <kbd
                      class="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 tabular-nums"
                      title="Keyboard shortcut: ⌘ or Ctrl + Enter"
                    >⌘↵</kbd>
                  {/if}
                </div>
              {:else}
                <div
                  class="text-xs text-slate-500 dark:text-slate-400 italic px-1 py-2 text-center select-none"
                  aria-label={`Adding cards to ${col.title} is closed in the ${PHASE_LABEL[conn.state.phase]} phase`}
                >
                  {col.key === 'actions'
                    ? 'Action items open in the Actions phase.'
                    : 'Card entry closed — Brainstorm phase only.'}
                </div>
              {/if}
            </footer>
          </section>
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
{/if}
