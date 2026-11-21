<script lang="ts">
  import { onMount, tick } from 'svelte';
  import BoardColumn from './BoardColumn.svelte';
  import ClusterRow from './ClusterRow.svelte';
  import { createCluster, dissolveCluster, mergeCluster, moveCard, renameCluster, setCardCluster } from './yboard';
  import { track } from './analytics';
  import { alignedRows, canEditClusters, clustersVisible, layoutBoard, planDrop, reorderTarget, sameDropTarget, sectionOf, type ClusterActions, type ClusterLane, type DropTarget } from './clusters';
  import { ACTIONS_COLUMN_KEY, BOARD_GRID_CLASS, COLUMN_STYLE, isWideBoard } from './columns';
  import { canAddCardInColumn, canSortByVotes, canVoteInPhase } from './phase';
  import type { CardActions } from './cardActions';
  import type { Viewer } from './viewer';
  import type { CardData } from './types';
  import type { UseBoardConnectionState } from './useBoardConnection.svelte';

  // The column view of a board: the grid, group rows, and card dragging. Board
  // keeps the connection, header, phases and end flow.
  interface Props {
    board: UseBoardConnectionState;
    cardActions: CardActions;
    ended: boolean;
    viewer: Viewer;
    userName: string;
    // Already false once the board has ended.
    isLead: boolean;
    namesMap: Record<string, string>;
    typingByCard: Map<string, string[]>;
    reducedMotion: boolean;
    coarsePointer: boolean;
    onRenameColumn: (key: string, title: string) => void;
    // False for a canvas board's List view: same cards, nothing to reorder.
    // Cards there have places of their own on the canvas, and the order they sit
    // in is where unplaced ones start.
    arrangeable?: boolean;
    // Whether groups show and can be changed, with the Group menu and each
    // group's name, Ungroup and Merge. A canvas board's List view has them too,
    // and it's the way to group on a phone. Dragging to group stays off there.
    groupable?: boolean;
  }

  let {
    board,
    cardActions,
    ended,
    viewer,
    userName,
    isLead,
    namesMap,
    typingByCard,
    reducedMotion,
    coarsePointer,
    onRenameColumn,
    arrangeable = true,
    groupable = arrangeable
  }: Props = $props();

  let dragCardId = $state<string | null>(null);
  let dragFromCol = $state<string | null>(null);
  let dropTarget = $state<DropTarget | null>(null);
  let focusedCardId = $state<string | null>(null);
  // Group rows line up across columns only where columns sit side by side. The
  // fallback for a browser without subgrid is the stacked layout phones use.
  let canAlignRows = $state<boolean>(false);

  onMount(() => {
    if (!window.matchMedia || !CSS.supports('grid-template-rows', 'subgrid')) return;
    const desktop = window.matchMedia('(min-width: 768px)');
    const onChange = () => (canAlignRows = desktop.matches);
    onChange();
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  });

  // The board scrolls sideways when its columns don't fit (BOARD_GRID_CLASS).
  // Tracked to show the edge fades and pin group names to the left.
  let scroller = $state<HTMLDivElement | null>(null);
  let overflowing = $state(false);
  let atStart = $state(true);
  let atEnd = $state(true);
  // The column most in view, for the phone's column chips.
  let activeColumn = $state(0);
  let chips = $state<HTMLElement | null>(null);

  function columnSections(): HTMLElement[] {
    return scroller ? [...scroller.querySelectorAll<HTMLElement>(':scope > section')] : [];
  }

  function measureScroll() {
    if (!scroller) return;
    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    overflowing = scrollWidth > clientWidth + 1;
    atStart = scrollLeft <= 1;
    atEnd = scrollLeft + clientWidth >= scrollWidth - 1;
    const view = scroller.getBoundingClientRect();
    let best = 0;
    let bestShown = -1;
    columnSections().forEach((section, i) => {
      const r = section.getBoundingClientRect();
      const shown = Math.min(r.right, view.right) - Math.max(r.left, view.left);
      if (shown > bestShown + 1) {
        best = i;
        bestShown = shown;
      }
    });
    activeColumn = best;
  }

  $effect(() => {
    const chip = chips?.children[activeColumn];
    if (chip instanceof HTMLElement && chips) {
      chips.scrollTo({ left: chip.offsetLeft - chips.clientWidth / 2 + chip.offsetWidth / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  });

  // Phone column chips: swipe the board to that column. If the page is
  // scrolled down past the end of it (a short column), go back up to its top.
  function showColumn(index: number) {
    const section = columnSections()[index];
    if (!scroller || !section) return;
    const behavior = reducedMotion ? 'auto' : 'smooth';
    const pad = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;
    const offset = section.getBoundingClientRect().left - scroller.getBoundingClientRect().left - pad;
    scroller.scrollTo({ left: scroller.scrollLeft + offset, behavior });
    const top = section.getBoundingClientRect().top;
    const below = (chips?.getBoundingClientRect().bottom ?? 0) + 8;
    if (section.getBoundingClientRect().bottom < below + 96) window.scrollBy({ top: top - below, behavior });
  }

  $effect(() => {
    const el = scroller;
    if (!el || typeof ResizeObserver === 'undefined') return;
    void board.columns.length;
    const observer = new ResizeObserver(measureScroll);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  });

  // Dragging a card near the board's left or right edge scrolls it, so an
  // off-screen column can still be a drop target. Scroll snapping is off
  // while dragging, or it would pull each small step back.
  function scrollWhileDragging(e: DragEvent) {
    if (!dragCardId || !scroller || !overflowing) return;
    const box = scroller.getBoundingClientRect();
    const edge = 56;
    const step = e.clientX < box.left + edge ? -1 : e.clientX > box.right - edge ? 1 : 0;
    if (step) scroller.scrollLeft += step * 18;
  }

  // After a keyboard move to another column the card is a new element: keep
  // focus on it and bring it into view if that column is off screen.
  async function revealCard(cardId: string) {
    await tick();
    const el = scroller?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  const canVote = $derived(canVoteInPhase(board.phase));

  // Display-only: never rewrites the underlying Y.Array, so this adds no new
  // CRDT conflict surface. Active once the lead moves into Discuss (and
  // stays active through Actions) — not during Vote itself, so the card
  // someone's about to vote on doesn't jump position mid-cast. Lead can also
  // turn it off entirely via the autoSort meta flag (on by default). Ties
  // keep original array position via stable sort. Manual drag-to-reorder is
  // disabled whenever the sort is actually active, since a drag would just
  // get overridden by the next sort on re-render.
  const sortActive = $derived(canSortByVotes(board.phase) && board.settings.autoSort);
  const canReorder = $derived(arrangeable && !sortActive);

  const layout = $derived(
    layoutBoard(board.columns, board.cards, board.clusters, {
      showClusters: groupable && clustersVisible(board.phase, ended),
      sortByVotes: sortActive
    })
  );
  const aligned = $derived(canAlignRows && layout.lanes.length > 0);
  const inputColumnCount = $derived(board.columns.filter((c) => c.key !== ACTIONS_COLUMN_KEY).length);
  const canCluster = $derived(groupable && canEditClusters(board.phase, ended));
  const canMergeClusters = $derived(canCluster && isLead);
  const dragCanGroup = $derived(canCluster && dragFromCol !== null && dragFromCol !== ACTIONS_COLUMN_KEY);

  function cardsIn(col: string): CardData[] {
    return board.cards[col] ?? [];
  }

  function laneOfCard(cardId: string): string | null {
    return layout.lanes.find((lane) => Object.values(lane.cards).some((list) => list.some((c) => c.id === cardId)))?.cluster.id ?? null;
  }
  const dragIsGrouped = $derived(dragCardId !== null && laneOfCard(dragCardId) !== null);
  function mergeTitle(lane: ClusterLane): string {
    return board.columns.find((c) => (lane.cards[c.key]?.length ?? 0) > 0)?.title ?? '';
  }
  const clusterActions: ClusterActions = {
    join(column, cardId, clusterId) {
      if (!board.board) return;
      setCardCluster(board.board.board, column, cardId, clusterId);
      track({ name: 'card_group', params: { action: 'join', source: 'menu' } });
    },
    create(column, cardId, label) {
      const state = board.board;
      if (!state) return;
      state.doc.transact(() => {
        setCardCluster(state.board, column, cardId, createCluster(state.clusters, label));
      });
      track({ name: 'card_group', params: { action: 'create', source: 'menu' } });
    },
    leave(column, cardId) {
      if (!board.board) return;
      setCardCluster(board.board.board, column, cardId, null);
      track({ name: 'card_group', params: { action: 'leave', source: 'menu' } });
    },
    rename(clusterId, label) {
      if (board.board) renameCluster(board.board.clusters, clusterId, label);
    },
    dissolve(clusterId) {
      if (!board.board) return;
      dissolveCluster(board.board.doc, board.board.board, clusterId);
      track({ name: 'card_group', params: { action: 'ungroup', source: 'menu' } });
    },
    merge(clusterId) {
      if (!board.board) return;
      mergeCluster(board.board.doc, board.board.board, clusterId, board.columns.map((c) => c.key));
      track({ name: 'card_group', params: { action: 'merge', source: 'menu' } });
    }
  };

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
    const state = board.board;
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
        track({ name: 'card_group', params: { action: plan.clusterId ? 'join' : 'leave', source: 'drag' } });
        break;
      case 'moveLoose':
        state.doc.transact(() => {
          setCardCluster(state.board, source.column, source.cardId, null);
          moveCard(state.doc, state.board, source.column, source.cardId, plan.column, plan.beforeId);
        });
        if (source.clusterId) track({ name: 'card_group', params: { action: 'leave', source: 'drag' } });
        break;
      case 'newClusterWith':
        state.doc.transact(() => {
          const id = createCluster(state.clusters);
          setCardCluster(state.board, plan.column, plan.cardId, id);
          setCardCluster(state.board, source.column, source.cardId, id);
        });
        track({ name: 'card_group', params: { action: 'create', source: 'drag' } });
        break;
    }
    onDragEnd();
  }

  // Keyboard-driven card move: shift+arrow on a focused card moves it
  // within or between columns. Mirrors drag-and-drop without the mouse.
  function findCard(cardId: string): { col: string; index: number } | null {
    for (const col of board.columns) {
      const idx = cardsIn(col.key).findIndex((c) => c.id === cardId);
      if (idx >= 0) return { col: col.key, index: idx };
    }
    return null;
  }

  function neighborColumn(col: string, direction: -1 | 1): string | null {
    const columns = board.columns;
    const i = columns.findIndex((c) => c.key === col);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= columns.length) return null;
    return columns[j].key;
  }

  function moveFocused(direction: 'up' | 'down' | 'left' | 'right') {
    if (!focusedCardId || !board.board || !canReorder) return;
    const loc = findCard(focusedCardId);
    if (!loc) return;
    const { col } = loc;
    if (direction === 'up' || direction === 'down') {
      const target = reorderTarget(sectionOf(layout, col, focusedCardId), focusedCardId, direction === 'up' ? -1 : 1);
      if (!target) return;
      moveCard(board.board.doc, board.board.board, col, focusedCardId, col, target.beforeId);
    } else {
      const dir = direction === 'left' ? -1 : 1;
      const target = neighborColumn(col, dir);
      if (!target) return;
      moveCard(board.board.doc, board.board.board, col, focusedCardId, target, null);
      void revealCard(focusedCardId);
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
</script>

<main
  class="flex-1 w-full mx-auto px-3 sm:px-4 py-4 sm:py-6 {isWideBoard(board.columns.length) ? 'max-w-none' : 'max-w-7xl'}"
>
  {#if board.columns.length > 1}
    <nav
      bind:this={chips}
      aria-label="Columns"
      class="md:hidden sticky top-0 z-10 -mx-3 sm:-mx-4 -mt-4 sm:-mt-6 mb-2 px-3 sm:px-4 py-2 flex gap-2 overflow-x-auto bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm [scrollbar-width:none]"
      data-testid="column-chips"
    >
      {#each board.columns as col, i (col.key)}
        <button
          type="button"
          class="shrink-0 inline-flex items-center gap-1.5 max-w-[14rem] min-h-[32px] rounded-full border px-3 text-xs transition-colors {i === activeColumn
            ? 'border-slate-400 bg-white text-slate-900 font-semibold shadow-sm dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100'
            : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}"
          aria-current={i === activeColumn ? 'true' : undefined}
          aria-label={`${col.title}, ${cardsIn(col.key).length} ${cardsIn(col.key).length === 1 ? 'card' : 'cards'}`}
          onclick={() => showColumn(i)}
        >
          <span class="size-2 shrink-0 rounded-full {COLUMN_STYLE[col.color].dot}" aria-hidden="true"></span>
          <span class="truncate">{col.title}</span>
          <span class="tabular-nums text-slate-400 dark:text-slate-500">{cardsIn(col.key).length}</span>
        </button>
      {/each}
    </nav>
  {/if}
  <div class="relative">
    <div
      bind:this={scroller}
      class={BOARD_GRID_CLASS}
      style="--board-cols: {board.columns.length}{aligned ? `; row-gap: 0; grid-template-rows: ${alignedRows(layout.lanes.length).template}` : ''}{dragCardId ? '; scroll-snap-type: none' : ''}{board.columns.length === 1 ? '; grid-auto-columns: 100%' : ''}"
      data-testid="board-columns"
      onscroll={measureScroll}
      ondragovercapture={scrollWhileDragging}
    >
      {#each board.columns as col, columnIndex (col.key)}
        <BoardColumn
          column={col}
          cards={layout.loose[col.key] ?? []}
          lanes={layout.lanes}
          cardCount={cardsIn(col.key).length}
          {aligned}
          {columnIndex}
          {canCluster}
          canMerge={canMergeClusters}
          {mergeTitle}
          {clusterActions}
          canAdd={canAddCardInColumn(col, board.phase) && !ended}
          phase={board.phase}
          {viewer}
          {userName}
          {isLead}
          readOnly={ended}
          {canVote}
          anonymous={board.settings.anonymous}
          {namesMap}
          {canReorder}
          hideCards={board.settings.hideCards}
          {dragCardId}
          {dragCanGroup}
          {dragIsGrouped}
          {dropTarget}
          {typingByCard}
          {reducedMotion}
          {coarsePointer}
          {cardActions}
          {onCardKeydown}
          onFocusCard={(id) => (focusedCardId = id)}
          {onDragStart}
          {onDragEnd}
          {onTargetDragOver}
          onColumnDragOver={(e) => onColumnDragOver(e, col.key)}
          onColumnDrop={(e) => onColumnDrop(e, col.key)}
          onRename={(t) => onRenameColumn(col.key, t)}
        />
      {/each}
      {#if aligned}
        {#each layout.lanes as lane, i (lane.cluster.id)}
          <ClusterRow
            {lane}
            titleRow={alignedRows(layout.lanes.length).titleRow(i)}
            columnSpan={inputColumnCount}
            scrolls={overflowing}
            canEdit={canCluster}
            canMerge={canMergeClusters}
            mergeInto={mergeTitle(lane)}
            {clusterActions}
            highlighted={dropTarget?.kind === 'group' && dropTarget.clusterId === lane.cluster.id}
            onDragOver={(e) => {
              if (!dragCanGroup) return;
              onTargetDragOver(e, { kind: 'group', column: board.columns[0].key, clusterId: lane.cluster.id });
            }}
            onDrop={(e) => onColumnDrop(e, board.columns[0].key)}
          />
        {/each}
      {/if}
    </div>
    {#if overflowing}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-0 z-[3] hidden md:block w-8 bg-linear-to-r from-slate-50 dark:from-slate-900 to-transparent transition-opacity {atStart ? 'opacity-0' : 'opacity-100'}"
      ></div>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 right-0 z-[3] hidden md:block w-8 bg-linear-to-l from-slate-50 dark:from-slate-900 to-transparent transition-opacity {atEnd ? 'opacity-0' : 'opacity-100'}"
        data-testid="board-more-right"
      ></div>
    {/if}
  </div>
</main>
