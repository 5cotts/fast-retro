<script lang="ts">
  import { onMount } from 'svelte';
  import BoardColumn from './BoardColumn.svelte';
  import ClusterRow from './ClusterRow.svelte';
  import { createCluster, dissolveCluster, mergeCluster, moveCard, renameCluster, setCardCluster } from './yboard';
  import { track } from './analytics';
  import { alignedRows, canEditClusters, clustersVisible, layoutBoard, planDrop, reorderTarget, sameDropTarget, sectionOf, type ClusterActions, type ClusterLane, type DropTarget } from './clusters';
  import { ACTIONS_COLUMN_KEY, boardGridClass, isWideBoard } from './columns';
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
    // False for a canvas board's List view: same cards, nothing to rearrange,
    // because moving a card here would rebuild it and lose its canvas position.
    arrangeable?: boolean;
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
    arrangeable = true
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
      showClusters: arrangeable && clustersVisible(board.phase, ended),
      sortByVotes: sortActive
    })
  );
  const aligned = $derived(canAlignRows && layout.lanes.length > 0);
  const inputColumnCount = $derived(board.columns.filter((c) => c.key !== ACTIONS_COLUMN_KEY).length);
  const canCluster = $derived(arrangeable && canEditClusters(board.phase, ended));
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
  <div
    class={boardGridClass(board.columns.length)}
    style="--board-cols: {board.columns.length}{aligned ? `; row-gap: 0; grid-template-rows: ${alignedRows(layout.lanes.length).template}` : ''}"
    data-testid="board-columns"
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
          wide={isWideBoard(board.columns.length)}
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
</main>
