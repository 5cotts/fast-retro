<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Card from './Card.svelte';
  import {
    createBoard,
    addCard,
    editCardText,
    deleteCard,
    resetBoard,
    toggleVote,
    toggleReaction,
    addComment,
    deleteComment,
    moveCard,
    readCards,
    readTimer,
    readNames,
    setDisplayName,
    setTimerDuration,
    startTimer,
    pauseTimer,
    resetTimer,
    computeTimerRemaining,
    formatMMSS,
    exportCSV,
    getOrCreateUserId,
    pickColor,
    COLUMNS,
    type BoardState,
    type CardData,
    type ColumnKey,
    type PresenceUser,
    type TimerState
  } from './board';

  let { isLead = false } = $props<{ isLead?: boolean }>();

  let userName = $state<string>('');
  let promptingName = $state<boolean>(true);
  let nameInput = $state<string>('');
  let boardRef: BoardState | null = null;
  let userId = '';
  let namesMap = $state<Record<string, string>>({});
  let editingName = $state<boolean>(false);
  let editNameInput = $state<string>('');

  let cards = $state<Record<ColumnKey, CardData[]>>({
    wentWell: [],
    toImprove: [],
    actions: []
  });
  let drafts = $state<Record<ColumnKey, string>>({
    wentWell: '',
    toImprove: '',
    actions: ''
  });
  let presence = $state<PresenceUser[]>([]);
  let connected = $state<boolean>(false);
  let timerState = $state<TimerState>({
    durationSec: 0,
    startedAt: null,
    paused: false,
    pausedRemaining: null
  });
  let nowTick = $state<number>(Date.now());
  type ThemePref = 'auto' | 'light' | 'dark';
  let themePref = $state<ThemePref>('auto');
  let systemDark = $state<boolean>(false);
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
  let mediaQuery: MediaQueryList | null = null;
  const darkMode = $derived(themePref === 'dark' || (themePref === 'auto' && systemDark));
  let timerInputMin = $state<string>('5');
  let dragCardId = $state<string | null>(null);
  let dragFromCol = $state<ColumnKey | null>(null);
  let dragOverCol = $state<ColumnKey | null>(null);
  let dragOverIndex = $state<number>(-1);

  const tickInterval = $state<number>(0);
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let showMobileMenu = $state<boolean>(false);

  const remainingSec = $derived(computeTimerRemaining(timerState, nowTick));
  const timerRunning = $derived(
    timerState.startedAt !== null && !timerState.paused && remainingSec > 0
  );
  const timerExpired = $derived(
    timerState.durationSec > 0 && remainingSec === 0 && timerState.startedAt !== null && !timerState.paused
  );

  const typingByCard = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const p of presence) {
      if (p.typing && p.clientId !== currentClientId) {
        const list = map.get(p.typing) ?? [];
        list.push(p.name);
        map.set(p.typing, list);
      }
    }
    return map;
  });

  let currentClientId = $state<number>(-1);

  onMount(() => {
    userId = getOrCreateUserId();
    const storedName = localStorage.getItem('retro-name');
    const storedTheme = localStorage.getItem('retro-theme');
    if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'auto') {
      themePref = storedTheme;
    } else {
      const legacy = localStorage.getItem('retro-dark');
      if (legacy === '1') themePref = 'dark';
      else if (legacy === '0') themePref = 'light';
      else themePref = 'auto';
    }

    if (window.matchMedia) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      systemDark = mediaQuery.matches;
      mediaListener = (e) => {
        systemDark = e.matches;
      };
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', mediaListener);
      else mediaQuery.addListener(mediaListener);
    }

    if (storedName && storedName.trim()) {
      userName = storedName.trim();
      promptingName = false;
      start();
    }
    tickHandle = setInterval(() => {
      nowTick = Date.now();
    }, 1000);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', darkMode);
  });

  function cycleTheme() {
    const next: ThemePref = themePref === 'auto' ? 'light' : themePref === 'light' ? 'dark' : 'auto';
    themePref = next;
    localStorage.setItem('retro-theme', next);
  }

  function commitName() {
    const t = nameInput.trim();
    if (!t) return;
    userName = t;
    localStorage.setItem('retro-name', t);
    promptingName = false;
    start();
  }

  function start() {
    boardRef = createBoard();
    const { board, provider, doc, timer, names } = boardRef;
    currentClientId = doc.clientID;

    const recomputeCards = () => {
      cards = {
        wentWell: readCards(board, 'wentWell'),
        toImprove: readCards(board, 'toImprove'),
        actions: readCards(board, 'actions')
      };
    };

    const recomputeTimer = () => {
      timerState = readTimer(timer);
    };

    const recomputeNames = () => {
      namesMap = readNames(names);
    };

    board.observeDeep(recomputeCards);
    timer.observeDeep(recomputeTimer);
    names.observe(recomputeNames);
    recomputeCards();
    recomputeTimer();
    recomputeNames();

    setDisplayName(names, userId, userName);

    provider.on('status', (e: { status: string }) => {
      connected = e.status === 'connected';
    });

    const aw = provider.awareness;
    aw.setLocalStateField('user', {
      name: userName,
      color: pickColor(userName),
      isLead,
      typing: null
    });

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
      presence = out;
    };
    aw.on('change', refreshPresence);
    refreshPresence();

    const beforeUnload = () => {
      aw.setLocalState(null);
    };
    window.addEventListener('beforeunload', beforeUnload);

    (boardRef as any)._cleanup = () => {
      window.removeEventListener('beforeunload', beforeUnload);
      board.unobserveDeep(recomputeCards);
      timer.unobserveDeep(recomputeTimer);
      names.unobserve(recomputeNames);
      aw.off('change', refreshPresence);
      aw.setLocalState(null);
      provider.destroy();
      doc.destroy();
    };
  }

  function applyNameChange(newName: string) {
    const t = newName.trim().slice(0, 40);
    if (!t || t === userName) {
      editingName = false;
      return;
    }
    userName = t;
    localStorage.setItem('retro-name', t);
    if (boardRef) {
      setDisplayName(boardRef.names, userId, t);
      const aw = boardRef.provider.awareness;
      const cur = aw.getLocalState() as { user?: any } | null;
      const user = cur?.user ?? {};
      aw.setLocalStateField('user', { ...user, name: t, color: pickColor(t) });
    }
    editingName = false;
  }

  function startNameEdit() {
    editNameInput = userName;
    editingName = true;
  }

  onDestroy(() => {
    const c = boardRef && (boardRef as any)._cleanup;
    if (typeof c === 'function') c();
    if (tickHandle !== null) clearInterval(tickHandle);
    if (mediaQuery && mediaListener) {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', mediaListener);
      else mediaQuery.removeListener(mediaListener);
    }
  });

  function setTyping(target: string | null) {
    if (!boardRef) return;
    const aw = boardRef.provider.awareness;
    const cur = aw.getLocalState() as { user?: any } | null;
    const user = cur?.user ?? {};
    aw.setLocalStateField('user', { ...user, typing: target });
  }

  function submitNew(col: ColumnKey) {
    const text = drafts[col].trim();
    if (!text || !boardRef) return;
    addCard(boardRef.board, col, text, userId);
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
    if (!boardRef) return;
    editCardText(boardRef.board, col, cardId, text);
  }

  function handleDelete(col: ColumnKey, cardId: string) {
    if (!boardRef) return;
    deleteCard(boardRef.board, col, cardId);
  }

  function handleVote(col: ColumnKey, cardId: string) {
    if (!boardRef) return;
    toggleVote(boardRef.board, col, cardId, userId);
  }

  function handleReact(col: ColumnKey, cardId: string, emoji: string) {
    if (!boardRef) return;
    toggleReaction(boardRef.board, col, cardId, emoji, userId);
  }

  function handleAddComment(col: ColumnKey, cardId: string, text: string) {
    if (!boardRef) return;
    addComment(boardRef.board, col, cardId, text, userId);
  }

  function handleDeleteComment(col: ColumnKey, cardId: string, commentId: string) {
    if (!boardRef) return;
    deleteComment(boardRef.board, col, cardId, commentId);
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
      dragOverIndex = cards[col].length;
    }
  }

  function onColumnDrop(e: DragEvent, col: ColumnKey) {
    e.preventDefault();
    if (!boardRef || !dragCardId || !dragFromCol) {
      onDragEnd();
      return;
    }
    const toIndex = dragOverIndex < 0 ? cards[col].length : dragOverIndex;
    moveCard(boardRef.doc, boardRef.board, dragFromCol, dragCardId, col, toIndex);
    onDragEnd();
  }

  function leadSetTimer() {
    if (!boardRef || !isLead) return;
    const mins = parseFloat(timerInputMin);
    if (Number.isNaN(mins) || mins <= 0) return;
    setTimerDuration(boardRef.timer, Math.round(mins * 60));
  }

  function leadStart() {
    if (!boardRef || !isLead) return;
    startTimer(boardRef.timer);
  }

  function leadPause() {
    if (!boardRef || !isLead) return;
    pauseTimer(boardRef.timer);
  }

  function leadReset() {
    if (!boardRef || !isLead) return;
    resetTimer(boardRef.timer);
  }

  function downloadCSV() {
    const csv = exportCSV(cards);
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

  function endBoard() {
    if (!boardRef || !isLead) return;
    const hasContent =
      cards.wentWell.length + cards.toImprove.length + cards.actions.length > 0;
    if (!confirm('This will archive the board and clear it. Continue?')) return;
    if (hasContent && confirm('Download a CSV snapshot before clearing?')) {
      downloadCSV();
    }
    resetBoard(boardRef.doc, boardRef.board, boardRef.timer);
  }
</script>

{#if promptingName}
  <div class="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
    <form
      class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-6 w-full max-w-sm"
      onsubmit={(e) => {
        e.preventDefault();
        commitName();
      }}
    >
      <h1 class="text-xl font-semibold mb-1 text-slate-900 dark:text-slate-100">Welcome to the retro</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">What should we call you?</p>
      <input
        bind:value={nameInput}
        type="text"
        autofocus
        maxlength="40"
        placeholder="Your name"
        class="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
      <button
        type="submit"
        class="mt-4 w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md py-2 font-medium hover:opacity-90 disabled:opacity-50"
        disabled={!nameInput.trim()}
      >
        Join board
      </button>
      <button
        type="button"
        class="mt-3 w-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        onclick={cycleTheme}
        title="Cycle theme: auto → light → dark"
      >
        Theme: {themePref}{themePref === 'auto' ? ` (${darkMode ? 'dark' : 'light'})` : ''}
      </button>
    </form>
  </div>
{:else}
  <div class="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
    <header class="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-3 flex-wrap">
        <h1 class="text-base sm:text-lg font-semibold">Fast Retro</h1>
        {#if isLead}
          <span
            class="inline-flex items-center text-[10px] sm:text-xs font-semibold uppercase tracking-wide bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-200 border border-fuchsia-200 dark:border-fuchsia-700/50 rounded px-2 py-0.5"
          >
            Lead
          </span>
        {/if}

        <span
          class="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
          title={connected ? 'Connected' : 'Disconnected'}
        >
          <span
            class="inline-block w-2 h-2 rounded-full"
            class:bg-emerald-500={connected}
            class:bg-rose-500={!connected}
          ></span>
          {connected ? 'live' : '…'}
        </span>

        <div
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm tabular-nums
            {timerExpired
              ? 'border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 text-rose-700 dark:text-rose-200'
              : timerRunning
              ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200'
              : 'border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}"
          title="Timer"
        >
          <span>⏱</span>
          <span class="font-medium">{formatMMSS(remainingSec)}</span>
          {#if timerState.paused}
            <span class="text-xs opacity-70">(paused)</span>
          {/if}
          {#if timerExpired}
            <span class="text-xs">⏰</span>
          {/if}
        </div>

        <button
          class="sm:hidden ml-auto inline-flex items-center justify-center min-w-[44px] min-h-[36px] text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
          onclick={() => (showMobileMenu = !showMobileMenu)}
          aria-label="Toggle menu"
          aria-expanded={showMobileMenu}
        >
          ☰
        </button>

        <div class="hidden sm:contents">
          {#if isLead}
            <div class="inline-flex items-center gap-1 text-xs">
              <input
                bind:value={timerInputMin}
                type="number"
                min="0"
                step="0.5"
                class="w-14 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-1.5 py-0.5"
                title="Minutes"
              />
              <button
                class="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                onclick={leadSetTimer}
              >
                Set
              </button>
              <button
                class="px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/40"
                onclick={leadStart}
              >
                ▶
              </button>
              <button
                class="px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/40"
                onclick={leadPause}
              >
                ⏸
              </button>
              <button
                class="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                onclick={leadReset}
              >
                ⟲
              </button>
            </div>

            <button
              class="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
              onclick={downloadCSV}
              title="Export to CSV"
            >
              ⤓ Export CSV
            </button>

            <button
              class="text-xs px-2 py-1 rounded border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-900/30"
              onclick={endBoard}
              title="Archive & clear board"
            >
              ⨯ End board
            </button>
          {/if}

          <button
            class="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
            onclick={cycleTheme}
            title={`Theme: ${themePref}${themePref === 'auto' ? ' (follows system)' : ''} — click to cycle`}
          >
            {themePref === 'auto' ? '🖥' : darkMode ? '☀' : '🌙'}
          </button>

          <div class="ml-auto flex items-center gap-2 flex-wrap">
            <span class="text-xs text-slate-500 dark:text-slate-400 mr-1">{presence.length} online:</span>
            {#each presence as p (p.clientId)}
              <span
                class="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-full px-2 py-0.5"
                title={p.isLead ? `${p.name} (Lead)` : p.name}
              >
                <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}"></span>
                {p.name}{p.isLead ? ' ⭐' : ''}
                {#if p.typing}
                  <span class="text-slate-400 dark:text-slate-500 italic ml-0.5">…</span>
                {/if}
              </span>
            {/each}
            {#if editingName}
              <form
                class="inline-flex items-center gap-1"
                onsubmit={(e) => {
                  e.preventDefault();
                  applyNameChange(editNameInput);
                }}
              >
                <input
                  bind:value={editNameInput}
                  type="text"
                  maxlength="40"
                  autofocus
                  class="text-xs w-28 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-1.5 py-0.5"
                  onkeydown={(e) => {
                    if (e.key === 'Escape') editingName = false;
                  }}
                />
                <button type="submit" class="text-xs px-1.5 py-0.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900">Save</button>
                <button type="button" class="text-xs px-1.5 py-0.5 text-slate-500" onclick={() => (editingName = false)}>×</button>
              </form>
            {:else}
              <button
                class="text-xs px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                onclick={startNameEdit}
                title="Change your display name"
              >
                ✎ {userName}
              </button>
            {/if}
          </div>
        </div>
      </div>

      {#if showMobileMenu}
        <div class="sm:hidden border-t border-slate-200 dark:border-slate-700 px-3 py-3 space-y-3 bg-slate-50 dark:bg-slate-800/60">
          {#if isLead}
            <div class="flex items-center gap-1.5 text-xs flex-wrap">
              <input
                bind:value={timerInputMin}
                type="number"
                min="0"
                step="0.5"
                class="w-16 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-2 py-1.5 min-h-[36px]"
                title="Minutes"
              />
              <button class="px-3 py-1.5 min-h-[36px] rounded border border-slate-300 dark:border-slate-600" onclick={leadSetTimer}>Set</button>
              <button class="px-3 py-1.5 min-h-[36px] rounded border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200" onclick={leadStart}>▶</button>
              <button class="px-3 py-1.5 min-h-[36px] rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200" onclick={leadPause}>⏸</button>
              <button class="px-3 py-1.5 min-h-[36px] rounded border border-slate-300 dark:border-slate-600" onclick={leadReset}>⟲</button>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                class="text-sm px-3 py-2 min-h-[44px] rounded border border-slate-300 dark:border-slate-600"
                onclick={downloadCSV}
              >
                ⤓ Export CSV
              </button>
              <button
                class="text-sm px-3 py-2 min-h-[44px] rounded border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-200"
                onclick={endBoard}
              >
                ⨯ End board
              </button>
            </div>
          {/if}
          <div class="flex items-center gap-2 flex-wrap">
            <button
              class="text-sm px-3 py-2 min-h-[44px] rounded border border-slate-300 dark:border-slate-600"
              onclick={cycleTheme}
            >
              {themePref === 'auto' ? '🖥' : darkMode ? '☀' : '🌙'} Theme: {themePref}
            </button>
            {#if editingName}
              <form
                class="flex items-center gap-1.5 w-full"
                onsubmit={(e) => {
                  e.preventDefault();
                  applyNameChange(editNameInput);
                }}
              >
                <input
                  bind:value={editNameInput}
                  type="text"
                  maxlength="40"
                  autofocus
                  class="flex-1 text-sm min-h-[44px] border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-2 py-1.5"
                />
                <button type="submit" class="text-sm px-3 py-2 min-h-[44px] rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900">Save</button>
                <button type="button" class="text-sm px-2 py-2 min-h-[44px] text-slate-500" onclick={() => (editingName = false)}>×</button>
              </form>
            {:else}
              <button
                class="text-sm px-3 py-2 min-h-[44px] rounded border border-slate-300 dark:border-slate-600"
                onclick={startNameEdit}
              >
                ✎ Name: {userName}
              </button>
            {/if}
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs text-slate-500 dark:text-slate-400 w-full">{presence.length} online</span>
            {#each presence as p (p.clientId)}
              <span
                class="inline-flex items-center gap-1 text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-full px-2 py-1"
              >
                <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}"></span>
                {p.name}{p.isLead ? ' ⭐' : ''}
              </span>
            {/each}
          </div>
        </div>
      {/if}
    </header>

    <main class="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {#each COLUMNS as col (col.key)}
          {@const typingNew = typingByCard.get(`new-${col.key}`) ?? []}
          <section
            class="border rounded-xl shadow-sm flex flex-col {col.accent}"
            ondragover={(e) => onColumnDragOver(e, col.key)}
            ondrop={(e) => onColumnDrop(e, col.key)}
          >
            <header class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between bg-white/60 dark:bg-slate-800/40 rounded-t-xl">
              <h2 class="font-semibold text-slate-800 dark:text-slate-100">{col.title}</h2>
              <span class="text-xs text-slate-500 dark:text-slate-400">{cards[col.key].length}</span>
            </header>
            <div class="p-3 flex-1 space-y-2 min-h-[80px]">
              {#each cards[col.key] as card, i (card.id)}
                {@const typers = typingByCard.get(card.id) ?? []}
                <div
                  class="relative"
                  ondragover={(e) => onCardSlotDragOver(e, col.key, i)}
                >
                  {#if dragOverCol === col.key && dragOverIndex === i && dragCardId !== card.id}
                    <div class="h-1 -mt-1 mb-1 bg-sky-400 rounded-full"></div>
                  {/if}
                  <Card
                    {card}
                    column={col.key}
                    {userId}
                    {userName}
                    {isLead}
                    {namesMap}
                    onEdit={(id, text) => handleEdit(col.key, id, text)}
                    onDelete={(id) => handleDelete(col.key, id)}
                    onToggleVote={(id) => handleVote(col.key, id)}
                    onToggleReaction={(id, e) => handleReact(col.key, id, e)}
                    onAddComment={(id, t) => handleAddComment(col.key, id, t)}
                    onDeleteComment={(id, cid) => handleDeleteComment(col.key, id, cid)}
                    onTypingComment={(target) => setTyping(target)}
                    {onDragStart}
                    {onDragEnd}
                  />
                  {#if typers.length > 0}
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 italic pl-1 mt-0.5">
                      {typers.join(', ')} typing…
                    </div>
                  {/if}
                </div>
              {/each}
              {#if dragOverCol === col.key && dragOverIndex >= cards[col.key].length}
                <div class="h-1 bg-sky-400 rounded-full"></div>
              {/if}
            </div>
            <footer class="p-3 border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 rounded-b-xl">
              <textarea
                bind:value={drafts[col.key]}
                onkeydown={(e) => onNewKey(e, col.key)}
                onfocus={() => setTyping(`new-${col.key}`)}
                onblur={() => setTyping(null)}
                placeholder="Add a card…  (⌘/Ctrl+Enter)"
                rows="2"
                class="w-full resize-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              ></textarea>
              {#if typingNew.length > 0}
                <div class="text-[10px] text-slate-500 dark:text-slate-400 italic pl-1 mt-0.5">
                  {typingNew.join(', ')} typing…
                </div>
              {/if}
              <button
                onclick={() => submitNew(col.key)}
                disabled={!drafts[col.key].trim()}
                class="mt-2 w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm rounded-md py-1.5 font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </footer>
          </section>
        {/each}
      </div>
    </main>

    <footer class="text-center text-xs text-slate-400 dark:text-slate-600 py-4">
      fast-retro · joined as <span class="font-medium text-slate-500 dark:text-slate-500">{userName}</span>
    </footer>
  </div>
{/if}
