<script lang="ts">
  import Card from './Card.svelte';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { COLUMN_PLACEHOLDER, COLUMN_STYLE, columnEmptyHint, isActionsColumn, type ColumnDef } from './columns';
  import { PHASE_LABEL, type Phase } from './phase';
  import type { CardData } from './types';

  // One board column: header, cards, drop targets and composer. Drag state
  // lives in Board.svelte, which owns cross-column moves; this only renders it.
  interface Props {
    column: ColumnDef;
    cards: CardData[];
    canAdd: boolean;
    phase: Phase;
    userId: string;
    userName: string;
    isLead: boolean;
    readOnly: boolean;
    canVote: boolean;
    anonymous: boolean;
    namesMap: Record<string, string>;
    mergeMode: boolean;
    canReorder: boolean;
    dragCardId: string | null;
    dragMergeTargetId: string | null;
    // Index of the drop indicator in this column, or -1 when not dragging here.
    dropIndex: number;
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
    onMergeDragOver: (cardId: string) => void;
    onMergeDragLeave: (cardId: string) => void;
    onMergeDrop: (cardId: string) => void;
    onSlotDragOver: (e: DragEvent, index: number) => void;
    onColumnDragOver: (e: DragEvent) => void;
    onColumnDrop: (e: DragEvent) => void;
  }

  let {
    column,
    cards,
    canAdd,
    phase,
    userId,
    userName,
    isLead,
    readOnly,
    canVote,
    anonymous,
    namesMap,
    mergeMode,
    canReorder,
    dragCardId,
    dragMergeTargetId,
    dropIndex,
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
    onMergeDragOver,
    onMergeDragLeave,
    onMergeDrop,
    onSlotDragOver,
    onColumnDragOver,
    onColumnDrop
  }: Props = $props();

  let draft = $state('');
  const style = $derived(COLUMN_STYLE[column.color]);
  const typingNew = $derived(typingByCard.get(`new-${column.key}`) ?? []);

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

<section
  class="border rounded-xl shadow-sm flex flex-col {style.accent}"
  role="list"
  aria-label={column.title}
  ondragover={onColumnDragOver}
  ondrop={onColumnDrop}
>
  <header class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between rounded-t-xl {style.header}">
    <div class="flex items-center gap-2">
      <span class="w-1.5 h-5 rounded-full {style.dot}" aria-hidden="true"></span>
      <h2 class="font-semibold tracking-tight text-slate-800 dark:text-slate-100">{column.title}</h2>
    </div>
    <span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{cards.length}</span>
  </header>
  <div class="p-3 flex-1 space-y-2 min-h-[96px]">
    {#if cards.length === 0}
      <div class="text-xs text-slate-400 dark:text-slate-500 italic px-1 py-2 select-none">
        {columnEmptyHint(column)}
      </div>
    {/if}
    {#each cards as card, i (card.id)}
      {@const typers = typingByCard.get(card.id) ?? []}
      <div
        class="relative"
        role="listitem"
        ondragover={(e) => onSlotDragOver(e, i)}
        in:fly|global={{ y: 6, duration: reducedMotion ? 0 : 180, easing: cubicOut }}
        animate:flip={{ duration: reducedMotion ? 0 : 500, easing: cubicOut }}
      >
        {#if dropIndex === i && dragCardId !== card.id}
          <div class="h-1 -mt-1 mb-1 bg-sky-400 rounded-full motion-safe:animate-pulse"></div>
        {/if}
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
          mergeMode={mergeMode && dragCardId !== null && dragCardId !== card.id}
          isMergeTarget={dragMergeTargetId === card.id}
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
          onMergeDragOver={() => onMergeDragOver(card.id)}
          onMergeDragLeave={() => onMergeDragLeave(card.id)}
          onMergeDrop={() => onMergeDrop(card.id)}
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
    {#if dropIndex >= cards.length}
      <div class="h-1 bg-sky-400 rounded-full motion-safe:animate-pulse"></div>
    {/if}
  </div>
  <footer class="p-3 border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/40 rounded-b-xl">
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
