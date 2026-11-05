<script lang="ts">
  import Card from './Card.svelte';
  import HiddenCard from './HiddenCard.svelte';
  import EditableHeading from './EditableHeading.svelte';
  import ClusterHeader from './ClusterHeader.svelte';
  import CardGroupMenu from './CardGroupMenu.svelte';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { COLUMN_PLACEHOLDER, COLUMN_STYLE, MAX_COLUMN_TITLE_LEN, columnEmptyHint, isActionsColumn, type ColumnDef } from './columns';
  import { alignedRows, clusterDisplayName, type ClusterActions, type ClusterLane, type DropTarget } from './clusters';
  import { isCardHidden } from './visibility';
  import { PHASE_LABEL, type Phase } from './phase';
  import type { CardData } from './types';

  // One board column: header, cards, drop targets and composer. Drag state
  // lives in Board.svelte, which owns cross-column moves; this only renders it.
  interface Props {
    column: ColumnDef;
    // Cards outside any group.
    cards: CardData[];
    // Every group on the board. This column shows those with a card in it.
    lanes: ClusterLane[];
    // Everything in this column, grouped or not.
    cardCount: number;
    // Desktop with groups showing: this column's lanes line up with the other
    // columns' through a shared grid (see alignedRows), and Board draws the
    // group names. Otherwise each column stacks its own blocks.
    aligned: boolean;
    // This column's position in the board, for that grid.
    columnIndex: number;
    canCluster: boolean;
    canMerge: boolean;
    // Title of the first column holding each group's cards (see mergeCluster).
    mergeTitle: (lane: ClusterLane) => string;
    clusterActions: ClusterActions;
    canAdd: boolean;
    phase: Phase;
    userId: string;
    userName: string;
    isLead: boolean;
    readOnly: boolean;
    canVote: boolean;
    anonymous: boolean;
    namesMap: Record<string, string>;
    canReorder: boolean;
    dragCardId: string | null;
    // Whether the card being dragged can be grouped by dropping it.
    dragCanGroup: boolean;
    // Whether it's in a group, so dropping in the loose area leaves it.
    dragIsGrouped: boolean;
    dropTarget: DropTarget | null;
    // The board's hide-cards setting (see visibility.ts).
    hideCards: boolean;
    typingByCard: Map<string, string[]>;
    reducedMotion: boolean;
    coarsePointer: boolean;
    onAddCard: (text: string) => void;
    onTyping: (target: string | null) => void;
    onEdit: (cardId: string, text: string) => void;
    onDelete: (cardId: string) => void;
    onToggleVote: (cardId: string) => void;
    onToggleReaction: (cardId: string, emoji: string) => void;
    onAddComment: (cardId: string, text: string) => void;
    onDeleteComment: (cardId: string, commentId: string) => void;
    onCardKeydown: (e: KeyboardEvent, cardId: string) => void;
    onFocusCard: (cardId: string) => void;
    onDragStart: (e: DragEvent, cardId: string, fromCol: string) => void;
    onDragEnd: () => void;
    onTargetDragOver: (e: DragEvent, target: DropTarget) => void;
    onColumnDragOver: (e: DragEvent) => void;
    onColumnDrop: (e: DragEvent) => void;
    // Host only: rename this column in place.
    onRename?: (title: string) => void;
  }

  let {
    column,
    cards,
    lanes,
    cardCount,
    aligned,
    columnIndex,
    canCluster,
    canMerge,
    mergeTitle,
    clusterActions,
    canAdd,
    phase,
    userId,
    userName,
    isLead,
    readOnly,
    canVote,
    anonymous,
    namesMap,
    canReorder,
    hideCards,
    dragCardId,
    dragCanGroup,
    dragIsGrouped,
    dropTarget,
    typingByCard,
    reducedMotion,
    coarsePointer,
    onAddCard,
    onTyping,
    onEdit,
    onDelete,
    onToggleVote,
    onToggleReaction,
    onAddComment,
    onDeleteComment,
    onCardKeydown,
    onFocusCard,
    onDragStart,
    onDragEnd,
    onTargetDragOver,
    onColumnDragOver,
    onColumnDrop,
    onRename
  }: Props = $props();

  let draft = $state('');
  const style = $derived(COLUMN_STYLE[column.color]);
  const typingNew = $derived(typingByCard.get(`new-${column.key}`) ?? []);
  const lanesHere = $derived(lanes.filter((lane) => (lane.cards[column.key]?.length ?? 0) > 0));
  const rows = $derived(alignedRows(lanes.length));
  const isActions = $derived(isActionsColumn(column));
  const groupOptions = $derived(lanes.map((lane) => lane.cluster));
  const canGroupHere = $derived(canCluster && !isActionsColumn(column));
  const canDropToGroup = $derived(dragCanGroup && !isActionsColumn(column));

  // The middle of a card groups, and its edges reorder. Outside the Group phase
  // all of it reorders. The edge is a fixed-ish strip, so tall cards still have a
  // reachable middle and short ones a reachable edge.
  function onCardDragOver(e: DragEvent, card: CardData, nextId: string | null, sectionId: string | null) {
    if (!dragCardId) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const edge = Math.min(rect.height * 0.25, 24);
    if (canDropToGroup && dragCardId !== card.id && y > edge && y < rect.height - edge) {
      onTargetDragOver(e, { kind: 'card', column: column.key, cardId: card.id, clusterId: sectionId });
      return;
    }
    const beforeId = y <= rect.height / 2 ? card.id : nextId;
    onTargetDragOver(e, { kind: 'slot', column: column.key, beforeId, sectionId });
  }

  function onGroupDragOver(e: DragEvent, clusterId: string) {
    if (!dragCardId || !canDropToGroup) return;
    e.stopPropagation();
    onTargetDragOver(e, { kind: 'group', column: column.key, clusterId });
  }

  function onLooseDragOver(e: DragEvent) {
    if (!dragCardId) return;
    e.stopPropagation();
    onTargetDragOver(e, { kind: 'slot', column: column.key, beforeId: null, sectionId: null });
  }

  function showsLineAbove(cardId: string, sectionId: string | null): boolean {
    return (
      dropTarget?.kind === 'slot' &&
      dropTarget.column === column.key &&
      dropTarget.sectionId === sectionId &&
      dropTarget.beforeId === cardId
    );
  }

  function showsLineAtEnd(sectionId: string | null): boolean {
    return (
      dropTarget?.kind === 'slot' &&
      dropTarget.column === column.key &&
      dropTarget.sectionId === sectionId &&
      dropTarget.beforeId === null
    );
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAddCard(text);
    draft = '';
    onTyping(null);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

{#snippet cardList(list: CardData[], laneId: string | null)}
  {#each list as card, i (card.id)}
    {@const typers = typingByCard.get(card.id) ?? []}
    <div
      class="relative has-[[role=menu]]:z-20 has-[[role=dialog]]:z-20"
      role="listitem"
      ondragover={(e) => onCardDragOver(e, card, list[i + 1]?.id ?? null, laneId)}
      in:fly|global={{ y: 6, duration: reducedMotion ? 0 : 180, easing: cubicOut }}
      animate:flip={{ duration: reducedMotion ? 0 : 500, easing: cubicOut }}
    >
      {#if showsLineAbove(card.id, laneId) && dragCardId !== card.id}
        <div class="h-1 -mt-1 mb-1 bg-sky-400 rounded-full motion-safe:animate-pulse"></div>
      {/if}
      {#if isCardHidden(card, column, { hideCards, phase, ended: readOnly, userId })}
        <HiddenCard />
      {:else}
        <Card
          {card}
          column={column.key}
          {userId}
          {userName}
          {isLead}
          {readOnly}
          {canVote}
          {anonymous}
          {namesMap}
          isGroupTarget={dropTarget?.kind === 'card' && dropTarget.cardId === card.id}
          {canReorder}
          {onEdit}
          {onDelete}
          {onToggleVote}
          {onToggleReaction}
          {onAddComment}
          {onDeleteComment}
          onTypingComment={(target) => onTyping(target)}
          onKeydown={(e) => onCardKeydown(e, card.id)}
          onFocusCard={() => onFocusCard(card.id)}
          {onDragStart}
          {onDragEnd}
        >
          {#snippet actions()}
            {#if canGroupHere}
              <CardGroupMenu
                groups={groupOptions}
                currentId={laneId}
                onJoin={(id) => clusterActions.join(column.key, card.id, id)}
                onCreate={(label) => clusterActions.create(column.key, card.id, label)}
                onLeave={() => clusterActions.leave(column.key, card.id)}
              />
            {/if}
          {/snippet}
        </Card>
      {/if}
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
  {#if showsLineAtEnd(laneId)}
    <div class="h-1 bg-sky-400 rounded-full motion-safe:animate-pulse"></div>
  {/if}
{/snippet}

{#snippet laneList(lane: ClusterLane, withHeader: boolean)}
  <div
    role="list"
    aria-label={`Group: ${clusterDisplayName(lane.cluster)}, ${lane.count} ${lane.count === 1 ? 'card' : 'cards'}`}
    class="space-y-2"
  >
    {#if withHeader}
      <ClusterHeader
        {lane}
        canEdit={canCluster}
        {canMerge}
        mergeInto={mergeTitle(lane)}
        onRename={(label) => clusterActions.rename(lane.cluster.id, label)}
        onDissolve={() => clusterActions.dissolve(lane.cluster.id)}
        onMerge={() => clusterActions.merge(lane.cluster.id)}
      />
    {/if}
    {@render cardList(lane.cards[column.key], lane.cluster.id)}
  </div>
{/snippet}

{#snippet looseCards()}
  {#if cardCount === 0}
    <div class="text-xs text-slate-400 dark:text-slate-500 italic px-1 py-2 select-none">
      {columnEmptyHint(column)}
    </div>
  {/if}
  {@render cardList(cards, null)}
  {#if dragCardId && dragCanGroup && dragIsGrouped}
    <div
      role="listitem"
      class="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400"
      data-testid="ungroup-zone"
      ondragover={onLooseDragOver}
    >
      Drop here to leave the group
    </div>
  {/if}
{/snippet}

<section
  class="border rounded-xl shadow-sm {aligned ? 'grid grid-rows-subgrid' : 'flex flex-col'} {style.accent}"
  style={aligned ? `grid-column: ${columnIndex + 1}; grid-row: 1 / span ${rows.total}` : undefined}
  role="list"
  aria-label={column.title}
  ondragover={onColumnDragOver}
  ondrop={onColumnDrop}
>
  <header
    class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between rounded-t-xl {style.header}"
    style={aligned ? 'grid-row: 1' : undefined}
  >
    <div class="flex items-center gap-2 min-w-0 flex-1">
      <span class="w-1.5 h-5 rounded-full shrink-0 {style.dot}" aria-hidden="true"></span>
      <EditableHeading
        title={column.title}
        canEdit={isLead && !readOnly && !!onRename}
        onRename={(t) => onRename?.(t)}
        inputLabel="Column name"
        hint="Click to rename this column"
        maxLength={MAX_COLUMN_TITLE_LEN}
      />
    </div>
    <span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{cardCount}</span>
  </header>
  {#if aligned && !isActions}
    {#each lanes as lane, i (lane.cluster.id)}
      {@const here = lane.cards[column.key] ?? []}
      <div
        role="listitem"
        class="relative z-[2] px-3 pt-1 pb-3 has-[[role=menu]]:z-30 has-[[role=dialog]]:z-30"
        style="grid-row: {rows.cellRow(i)}"
        data-testid="group-cell"
        ondragover={(e) => onGroupDragOver(e, lane.cluster.id)}
      >
        {#if here.length > 0}
          {@render laneList(lane, false)}
        {:else if dragCardId && canDropToGroup}
          <div class="h-full min-h-10 flex items-center justify-center rounded-lg border border-dashed border-violet-300 dark:border-violet-600 text-xs text-violet-700 dark:text-violet-300 text-center px-2 py-3 {dropTarget?.kind === 'group' && dropTarget.clusterId === lane.cluster.id ? 'bg-violet-100/70 dark:bg-violet-900/30' : ''}">
            Drop to add to this group
          </div>
        {/if}
      </div>
    {/each}
    <div class="p-3 space-y-2 min-h-[48px]" style="grid-row: {rows.looseRow}">
      {@render looseCards()}
    </div>
  {:else if aligned}
    <div class="p-3 space-y-2 min-h-[96px]" style="grid-row: 2 / span {rows.looseRow - 1}">
      {@render looseCards()}
    </div>
  {:else}
    <div class="p-3 flex-1 space-y-2 min-h-[96px]">
      {#each lanesHere as lane (lane.cluster.id)}
        <div
          role="listitem"
          class="rounded-lg border border-dashed bg-white/50 dark:bg-slate-800/30 p-2 transition-colors {dropTarget?.kind === 'group' && dropTarget.clusterId === lane.cluster.id ? 'border-violet-400 dark:border-violet-500 ring-2 ring-violet-300 dark:ring-violet-700' : 'border-slate-300 dark:border-slate-600'}"
          data-testid="group-block"
          ondragover={(e) => onGroupDragOver(e, lane.cluster.id)}
        >
          {@render laneList(lane, true)}
        </div>
      {/each}
      {@render looseCards()}
    </div>
  {/if}
  <footer
    class="p-3 border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 rounded-b-xl"
    style={aligned ? `grid-row: ${rows.footerRow}` : undefined}
  >
    {#if canAdd}
      <textarea
        bind:value={draft}
        onkeydown={onKey}
        onfocus={() => onTyping(`new-${column.key}`)}
        onblur={() => onTyping(null)}
        placeholder={COLUMN_PLACEHOLDER}
        rows="2"
        aria-label={`Add a card to ${column.title}`}
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
          onclick={submit}
          disabled={!draft.trim()}
          class="flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm rounded-md py-2 font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Add card
        </button>
        {#if !coarsePointer}
          <kbd
            class="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 tabular-nums"
            title="Enter to add, Shift+Enter for a new line"
          >↵</kbd>
        {/if}
      </div>
    {:else}
      <div
        class="text-xs text-slate-500 dark:text-slate-400 italic px-1 py-2 text-center select-none"
        aria-label={`Adding cards to ${column.title} is closed in the ${PHASE_LABEL[phase]} phase`}
      >
        {isActionsColumn(column)
          ? 'Action items open in the Actions phase.'
          : 'Card entry closed — Brainstorm phase only.'}
      </div>
    {/if}
  </footer>
</section>
