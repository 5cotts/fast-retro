<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Card from './Card.svelte';
  import BoardHeader from './BoardHeader.svelte';
  import NamePrompt from './NamePrompt.svelte';
  import {
    addCard,
    editCardText,
    deleteCard,
    resetBoard,
    toggleVote,
    toggleReaction,
    addComment,
    deleteComment,
    moveCard
  } from './yboard';
  import {
    setTimerDuration,
    startTimer,
    pauseTimer,
    resetTimer,
    computeTimerRemaining
  } from './timer';
  import { exportCSV } from './csv';
  import { getOrCreateUserId, setDisplayName } from './identity';
  import { getName, setName, getTheme, setTheme, type ThemePref } from './storage';
  import { updateAwarenessUser } from './awareness';
  import { useBoardConnection } from './useBoardConnection.svelte';
  import { COLUMNS, COLUMN_EMPTY_HINT, COLUMN_PLACEHOLDER, type CardData, type ColumnKey } from './types';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { disambiguateNames, disambiguateNamesMap } from './identity';
  import { Download, ArrowRight } from 'lucide-svelte';
  import { PHASES, PHASE_LABEL, PHASE_HINT, nextPhase, setPhase } from './phase';

  let { isLead = false, slug } = $props<{ isLead?: boolean; slug: string }>();

  let userName = $state<string>('');
  let promptingName = $state<boolean>(true);
  let nameInput = $state<string>('');
  let userId = $state<string>('');

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
      if (timerExpiredHandle !== null) clearTimeout(timerExpiredHandle);
      timerExpiredHandle = setTimeout(() => {
        timerJustExpired = false;
      }, 6000);
    }
    prevTimerExpired = expired;
  });

  onDestroy(() => {
    conn.destroy();
    if (tickHandle !== null) clearInterval(tickHandle);
    if (timerExpiredHandle !== null) clearTimeout(timerExpiredHandle);
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
    conn.start({ userId, userName, isLead, slug });
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

  const phaseIndex = $derived(PHASES.indexOf(conn.state.phase));
  const isLastPhase = $derived(phaseIndex === PHASES.length - 1);

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

  function confirmEndBoard(opts: { exportFirst: boolean }) {
    if (!conn.state.board || !isLead) {
      endConfirm = false;
      return;
    }
    if (opts.exportFirst) downloadCSV();
    resetBoard(conn.state.board.doc, conn.state.board.board, conn.state.board.timer);
    endConfirm = false;
  }
</script>

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
      onSetTimer={leadSetTimer}
      onStartTimer={leadStart}
      onPauseTimer={leadPause}
      onResetTimer={leadReset}
      onExportCSV={downloadCSV}
      onEndBoard={startEndBoard}
      onCycleTheme={cycleTheme}
      onChangeName={changeName}
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
        {#if isLead && !isLastPhase}
          <button
            class="ml-auto btn text-xs px-2.5 py-1 min-h-[28px]"
            onclick={advancePhase}
            aria-label={`Advance to ${PHASE_LABEL[PHASES[phaseIndex + 1]]} phase`}
          >
            Next phase
            <ArrowRight size={13} aria-hidden="true" />
          </button>
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
              This clears all cards, comments, and the timer for everyone. This can't be undone.
            </div>
          </div>
          {#if cardCount > 0}
            <button
              class="btn text-xs px-3 py-1.5"
              onclick={() => confirmEndBoard({ exportFirst: true })}
            >
              <Download size={14} aria-hidden="true" />
              Export CSV &amp; clear
            </button>
          {/if}
          <button
            class="btn-danger text-xs px-3 py-1.5"
            onclick={() => confirmEndBoard({ exportFirst: false })}
          >
            Clear board
          </button>
          <button class="btn-ghost text-xs px-3 py-1.5" onclick={cancelEndBoard}>Cancel</button>
        </div>
      </div>
    {/if}

    <main class="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {#each COLUMNS as col (col.key)}
          {@const typingNew = typingByCard.get(`new-${col.key}`) ?? []}
          {@const colCards = conn.state.cards[col.key]}
          <section
            class="border rounded-xl shadow-sm flex flex-col {col.accent}"
            role="list"
            aria-label={col.title}
            ondragover={(e) => onColumnDragOver(e, col.key)}
            ondrop={(e) => onColumnDrop(e, col.key)}
          >
            <header class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between bg-white/60 dark:bg-slate-800/40 rounded-t-xl">
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
            </footer>
          </section>
        {/each}
      </div>
    </main>

    <footer class="text-center text-xs text-slate-400 dark:text-slate-500 py-4">
      Joined as <span class="font-medium text-slate-500 dark:text-slate-400">{userName}</span>
    </footer>
  </div>

{/if}
