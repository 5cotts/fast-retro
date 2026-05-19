<script lang="ts">
  import type { CardData, CommentData, ColumnKey } from './types';
  import { REACTION_EMOJI } from './types';
  import { resolveDisplayName } from './identity';
  import { Pencil, Trash2, ChevronUp, Smile, MessageSquare, X, Check } from 'lucide-svelte';

  const REACTION_LABEL: Record<string, string> = {
    '👍': 'thumbs up',
    '❤️': 'heart',
    '🎉': 'party',
    '😂': 'laugh',
    '😢': 'sad',
    '🤔': 'thinking'
  };
  const reactionName = (e: string) => REACTION_LABEL[e] ?? e;

  const COLLAPSED_MAX_CHARS = 280;

  let {
    card,
    column,
    userId,
    userName,
    isLead,
    canVote = true,
    anonymous = false,
    namesMap,
    onEdit,
    onDelete,
    onToggleVote,
    onToggleReaction,
    onAddComment,
    onDeleteComment,
    onTypingComment,
    onDragStart,
    onDragEnd,
    onKeydown,
    onFocusCard
  } = $props<{
    card: CardData;
    column: ColumnKey;
    userId: string;
    userName: string;
    isLead: boolean;
    canVote?: boolean;
    anonymous?: boolean;
    namesMap: Record<string, string>;
    onEdit: (cardId: string, text: string) => void;
    onDelete: (cardId: string) => void;
    onToggleVote: (cardId: string) => void;
    onToggleReaction: (cardId: string, emoji: string) => void;
    onAddComment: (cardId: string, text: string) => void;
    onDeleteComment: (cardId: string, commentId: string) => void;
    onTypingComment: (cardId: string | null) => void;
    onDragStart: (e: DragEvent, cardId: string, fromCol: ColumnKey) => void;
    onDragEnd: () => void;
    onKeydown?: (e: KeyboardEvent) => void;
    onFocusCard?: () => void;
  }>();

  const displayName = (id: string) =>
    resolveDisplayName(id, { selfId: userId, selfName: userName, namesMap });

  const authorName = $derived(displayName(card.authorId));
  const isSelfAuthor = $derived(card.authorId === userId);

  let editing = $state(false);
  let editText = $state('');
  let showComments = $state(false);
  let commentDraft = $state('');
  let showReactionPicker = $state(false);
  let confirmingDelete = $state(false);
  let pendingCommentDelete = $state<string | null>(null);
  let dragging = $state(false);
  let pickerEl = $state<HTMLElement | null>(null);
  let pickerBtnEl = $state<HTMLButtonElement | null>(null);
  let pickerAlignRight = $state(false);
  let editTextarea = $state<HTMLTextAreaElement | null>(null);
  let expanded = $state(false);
  const isLong = $derived(card.text.length > COLLAPSED_MAX_CHARS);

  $effect(() => {
    if (editing && editTextarea) {
      editTextarea.focus();
      editTextarea.setSelectionRange(editTextarea.value.length, editTextarea.value.length);
    }
  });

  const hasVoted = $derived(card.votes.includes(userId));
  const voteCount = $derived(card.votes.length);
  const commentCount = $derived(card.comments.length);
  const canEdit = $derived(isLead || (!!card.authorId && card.authorId === userId));
  const sortedComments = $derived(
    card.comments.slice().sort((a: CommentData, b: CommentData) => a.createdAt - b.createdAt)
  );
  const reactionEntries = $derived(
    (Object.entries(card.reactions) as [string, string[]][]).filter(([, users]) => users.length > 0)
  );

  function startEdit() {
    editText = card.text;
    editing = true;
  }

  function saveEdit() {
    const t = editText.trim();
    if (t && t !== card.text) onEdit(card.id, t);
    editing = false;
  }

  function cancelEdit() {
    editing = false;
  }

  function submitComment() {
    const t = commentDraft.trim();
    if (!t) return;
    onAddComment(card.id, t);
    commentDraft = '';
    onTypingComment(null);
  }

  function onCommentKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitComment();
    }
  }

  $effect(() => {
    if (!showReactionPicker) return;
    // Clamp picker to viewport: if there isn't ~260px of room to the right of
    // the trigger button, anchor the picker to its right edge instead.
    if (pickerBtnEl && typeof window !== 'undefined') {
      const rect = pickerBtnEl.getBoundingClientRect();
      pickerAlignRight = rect.left + 260 > window.innerWidth;
    }
    const close = (e: MouseEvent) => {
      if (pickerEl && e.target instanceof Node && !pickerEl.contains(e.target)) {
        showReactionPicker = false;
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') showReactionPicker = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onEsc);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  draggable={!editing}
  tabindex="0"
  role="group"
  aria-label={`Card: ${card.text.slice(0, 80)}`}
  class="card group bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-3 text-sm shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 dark:focus:ring-offset-slate-900 transition-[box-shadow,border-color,transform,opacity] duration-200 ease-out cursor-grab active:cursor-grabbing active:scale-[0.99] {dragging ? 'opacity-50 scale-[1.02] rotate-[0.6deg] shadow-xl border-sky-400 dark:border-sky-500 ring-2 ring-sky-200 dark:ring-sky-900' : ''}"
  ondragstart={(e) => {
    dragging = true;
    onDragStart(e, card.id, column);
  }}
  ondragend={() => {
    dragging = false;
    onDragEnd();
  }}
  onkeydown={(e) => onKeydown?.(e)}
  onfocus={() => onFocusCard?.()}
>
  {#if editing}
    <textarea
      bind:this={editTextarea}
      bind:value={editText}
      rows="3"
      aria-label="Edit card text"
      class="input w-full resize-none px-2 py-1.5 text-sm leading-snug"
      onkeydown={(e) => {
        if (e.key === 'Escape') cancelEdit();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
      }}
    ></textarea>
    <div class="flex gap-2 mt-2">
      <button
        class="px-3 py-1.5 text-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md font-medium hover:opacity-90 transition-opacity"
        onclick={saveEdit}
      >
        Save
      </button>
      <button
        class="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        onclick={cancelEdit}
      >
        Cancel
      </button>
    </div>
  {:else}
    {#if isLong && !expanded}
      <div class="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100 leading-snug max-h-[10rem] overflow-hidden relative">
        {card.text}
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white dark:from-slate-800 to-transparent"></div>
      </div>
      <button
        class="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
        onclick={() => (expanded = true)}
        aria-expanded="false"
      >
        Show more
      </button>
    {:else}
      <div class="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100 leading-snug">{card.text}</div>
      {#if isLong}
        <button
          class="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
          onclick={() => (expanded = false)}
          aria-expanded="true"
        >
          Show less
        </button>
      {/if}
    {/if}
    {#if card.authorId}
      {@const showName = isSelfAuthor || !anonymous}
      <div
        class="mt-1.5 text-xs text-slate-500 dark:text-slate-500"
        title={isSelfAuthor
          ? anonymous
            ? 'Added by you — hidden from others (Anonymous mode)'
            : 'Added by you'
          : showName
            ? `Added by ${authorName}`
            : 'Author hidden — Anonymous mode'}
      >
        {#if isSelfAuthor}
          you{anonymous ? ' (hidden)' : ''}
        {:else if showName}
          {authorName}
        {:else}
          Anonymous
        {/if}
      </div>
    {/if}

    {#if reactionEntries.length > 0}
      <div class="mt-2.5 flex flex-wrap gap-1">
        {#each reactionEntries as [emoji, users] (emoji)}
          <button
            class="inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 min-h-[32px] transition-colors
              {users.includes(userId)
                ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-200'
                : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'}"
            onclick={() => onToggleReaction(card.id, emoji)}
            aria-label={users.includes(userId) ? `Remove your ${reactionName(emoji)} reaction (${users.length} total)` : `Add ${reactionName(emoji)} reaction (${users.length} so far)`}
            aria-pressed={users.includes(userId)}
          >
            <span aria-hidden="true">{emoji}</span>
            <span class="tabular-nums">{users.length}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="mt-2.5 flex items-center gap-1 flex-wrap text-xs text-slate-600 dark:text-slate-400">
      <button
        class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 min-h-[40px] transition-colors
          disabled:cursor-not-allowed disabled:opacity-60
          {hasVoted
            ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200'
            : 'border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:hover:bg-transparent'}"
        onclick={() => onToggleVote(card.id)}
        disabled={!canVote && !hasVoted}
        aria-label={hasVoted
          ? `Remove vote (${voteCount})`
          : canVote
            ? `Upvote (${voteCount})`
            : `Voting closed (${voteCount} votes)`}
        aria-pressed={hasVoted}
        title={canVote || hasVoted ? undefined : 'Voting is only open in the Vote phase.'}
      >
        <ChevronUp size={14} aria-hidden="true" />
        <span class="tabular-nums">{voteCount}</span>
      </button>

      <div class="relative">
        <button
          bind:this={pickerBtnEl}
          class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 min-h-[40px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          onclick={() => (showReactionPicker = !showReactionPicker)}
          aria-label="Add a reaction"
          aria-haspopup="menu"
          aria-expanded={showReactionPicker}
        >
          <Smile size={14} aria-hidden="true" />
        </button>
        {#if showReactionPicker}
          <div
            bind:this={pickerEl}
            class="absolute z-10 top-full mt-1 flex gap-0.5 p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 {pickerAlignRight ? 'right-0' : 'left-0'}"
            role="menu"
            aria-label="Pick a reaction"
          >
            {#each REACTION_EMOJI as emoji (emoji)}
              <button
                class="text-base hover:bg-slate-100 dark:hover:bg-slate-700 rounded p-1 min-w-[32px] min-h-[32px] flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                onclick={() => {
                  onToggleReaction(card.id, emoji);
                  showReactionPicker = false;
                }}
                role="menuitem"
                aria-label={`React with ${reactionName(emoji)}`}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 min-h-[40px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        onclick={() => (showComments = !showComments)}
        aria-label={`Comments (${commentCount})`}
        aria-expanded={showComments}
      >
        <MessageSquare size={14} aria-hidden="true" />
        <span class="tabular-nums">{commentCount}</span>
      </button>

      <span class="flex-1"></span>

      {#if canEdit}
        <button
          class="md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded min-w-[40px] min-h-[40px] md:min-w-[32px] md:min-h-[32px] flex items-center justify-center"
          aria-label="Edit card"
          onclick={startEdit}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          class="md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded min-w-[40px] min-h-[40px] md:min-w-[32px] md:min-h-[32px] flex items-center justify-center"
          aria-label="Delete card"
          onclick={() => (confirmingDelete = true)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      {/if}
    </div>

    {#if confirmingDelete}
      <div
        class="mt-2 p-2 rounded-md border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-xs flex items-center gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150"
        role="alertdialog"
        aria-label="Confirm delete card"
      >
        <span class="flex-1 text-rose-800 dark:text-rose-100">Delete this card?</span>
        <button
          class="btn-danger px-2.5 py-1"
          onclick={() => {
            onDelete(card.id);
            confirmingDelete = false;
          }}
        >
          Delete
        </button>
        <button class="btn-ghost px-2.5 py-1" onclick={() => (confirmingDelete = false)}>
          Cancel
        </button>
      </div>
    {/if}

    {#if showComments}
      <div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
        {#if sortedComments.length === 0}
          <div class="text-xs text-slate-500 dark:text-slate-500 italic">No comments yet.</div>
        {/if}
        {#each sortedComments as c (c.id)}
          <div class="text-xs flex items-start gap-1 group/c">
            <div class="flex-1 min-w-0">
              {#if c.authorId}
                {@const isSelfComment = c.authorId === userId}
                {@const showCommentName = isSelfComment || !anonymous}
                <span class="text-xs font-medium text-slate-600 dark:text-slate-300 mr-1.5">
                  {#if isSelfComment}
                    {displayName(c.authorId)} (you{anonymous ? ', hidden' : ''})
                  {:else if showCommentName}
                    {displayName(c.authorId)}
                  {:else}
                    Anonymous
                  {/if}
                </span>
              {/if}
              <span class="text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{c.text}</span>
            </div>
            {#if pendingCommentDelete === c.id}
              <button
                class="text-[11px] px-1.5 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                onclick={() => {
                  onDeleteComment(card.id, c.id);
                  pendingCommentDelete = null;
                }}
                aria-label="Confirm delete comment"
              >
                <Check size={12} aria-hidden="true" />
              </button>
              <button
                class="text-[11px] px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                onclick={() => (pendingCommentDelete = null)}
                aria-label="Cancel"
              >
                <X size={12} aria-hidden="true" />
              </button>
            {:else}
              <button
                class="opacity-0 group-hover/c:opacity-100 focus:opacity-100 text-slate-500 hover:text-rose-500 transition-opacity rounded p-0.5"
                aria-label="Delete comment"
                onclick={() => (pendingCommentDelete = c.id)}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/each}
        <div class="flex gap-1.5 mt-2">
          <input
            bind:value={commentDraft}
            type="text"
            placeholder="Add a comment…"
            aria-label="Add a comment"
            class="flex-1 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-400"
            onkeydown={onCommentKey}
            onfocus={() => onTypingComment(card.id)}
            onblur={() => onTypingComment(null)}
          />
          <button
            class="text-xs px-2.5 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md disabled:opacity-40 hover:opacity-90 transition-opacity"
            disabled={!commentDraft.trim()}
            onclick={submitComment}
          >
            Post
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
