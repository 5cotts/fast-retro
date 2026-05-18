<script lang="ts">
  import type { CardData, CommentData, ColumnKey } from './types';
  import { REACTION_EMOJI } from './types';
  import { resolveDisplayName } from './identity';

  let {
    card,
    column,
    userId,
    userName,
    isLead,
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

  let editing = $state(false);
  let editText = $state('');
  let showComments = $state(false);
  let commentDraft = $state('');
  let showReactionPicker = $state(false);
  let confirmingDelete = $state(false);
  let pendingCommentDelete = $state<string | null>(null);
  let pickerEl = $state<HTMLElement | null>(null);
  let editTextarea = $state<HTMLTextAreaElement | null>(null);

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

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<article
  draggable={!editing}
  tabindex="0"
  role="group"
  aria-label={`Card: ${card.text.slice(0, 80)}`}
  class="group bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2 text-sm shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-sky-400 transition-shadow cursor-grab active:cursor-grabbing"
  ondragstart={(e) => onDragStart(e, card.id, column)}
  ondragend={onDragEnd}
  onkeydown={(e) => onKeydown?.(e)}
  onfocus={() => onFocusCard?.()}
>
  {#if editing}
    <textarea
      bind:this={editTextarea}
      bind:value={editText}
      rows="3"
      aria-label="Edit card text"
      class="input w-full resize-none px-2 py-1.5 text-sm"
      onkeydown={(e) => {
        if (e.key === 'Escape') cancelEdit();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
      }}
    ></textarea>
    <div class="flex gap-2 mt-2">
      <button
        class="px-2 py-1 text-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded font-medium"
        onclick={saveEdit}
      >
        Save
      </button>
      <button
        class="px-2 py-1 text-xs text-slate-500 dark:text-slate-400 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
        onclick={cancelEdit}
      >
        Cancel
      </button>
    </div>
  {:else}
    <div class="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">{card.text}</div>
    {#if card.authorId}
      <div
        class="mt-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500"
        title={card.authorId === userId ? 'Added by you' : `Added by ${authorName}`}
      >
        — {card.authorId === userId ? 'you' : authorName}
      </div>
    {/if}

    {#if reactionEntries.length > 0}
      <div class="mt-2 flex flex-wrap gap-1">
        {#each reactionEntries as [emoji, users] (emoji)}
          <button
            class="inline-flex items-center gap-1 text-xs rounded-full border px-1.5 py-0.5 transition
              {users.includes(userId)
                ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-200'
                : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'}"
            onclick={() => onToggleReaction(card.id, emoji)}
            title={users.includes(userId) ? 'Remove your reaction' : 'React'}
          >
            <span>{emoji}</span>
            <span class="tabular-nums">{users.length}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="mt-2 flex items-center gap-1 flex-wrap text-xs text-slate-600 dark:text-slate-400">
      <button
        class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 min-h-[32px] transition
          {hasVoted
            ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200'
            : 'border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'}"
        onclick={() => onToggleVote(card.id)}
        title={hasVoted ? 'Remove vote' : 'Upvote'}
      >
        <span>▲</span>
        <span class="tabular-nums">{voteCount}</span>
      </button>

      <div class="relative">
        <button
          class="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 min-h-[32px] hover:bg-slate-100 dark:hover:bg-slate-700"
          onclick={() => (showReactionPicker = !showReactionPicker)}
          title="Add reaction"
        >
          😊+
        </button>
        {#if showReactionPicker}
          <div
            bind:this={pickerEl}
            class="absolute z-10 top-full left-0 mt-1 flex gap-1 p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg"
            role="menu"
          >
            {#each REACTION_EMOJI as emoji (emoji)}
              <button
                class="text-base hover:bg-slate-100 dark:hover:bg-slate-700 rounded px-1"
                onclick={() => {
                  onToggleReaction(card.id, emoji);
                  showReactionPicker = false;
                }}
              >
                {emoji}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 min-h-[32px] hover:bg-slate-100 dark:hover:bg-slate-700"
        onclick={() => (showComments = !showComments)}
      >
        💬 <span class="tabular-nums">{commentCount}</span>
      </button>

      <span class="flex-1"></span>

      {#if canEdit}
        <button
          class="md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 min-w-[32px] min-h-[32px] flex items-center justify-center"
          title="Edit"
          aria-label="Edit card"
          onclick={startEdit}
        >
          ✎
        </button>
        <button
          class="md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 min-w-[32px] min-h-[32px] flex items-center justify-center"
          title="Delete card"
          aria-label="Delete card"
          onclick={() => (confirmingDelete = true)}
        >
          ✕
        </button>
      {/if}
    </div>

    {#if confirmingDelete}
      <div
        class="mt-2 p-2 rounded border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-xs flex items-center gap-2"
        role="alertdialog"
        aria-label="Confirm delete card"
      >
        <span class="flex-1 text-rose-800 dark:text-rose-100">Delete this card?</span>
        <button
          class="btn-danger px-2 py-1"
          onclick={() => {
            onDelete(card.id);
            confirmingDelete = false;
          }}
        >
          Delete
        </button>
        <button class="btn-ghost px-2 py-1" onclick={() => (confirmingDelete = false)}>
          Cancel
        </button>
      </div>
    {/if}

    {#if showComments}
      <div class="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
        {#if sortedComments.length === 0}
          <div class="text-xs text-slate-400 dark:text-slate-500 italic">No comments yet.</div>
        {/if}
        {#each sortedComments as c (c.id)}
          <div class="text-xs flex items-start gap-1 group/c">
            <div class="flex-1 min-w-0">
              {#if c.authorId}
                <span class="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                  {displayName(c.authorId)}{c.authorId === userId ? ' (you)' : ''}:
                </span>
              {/if}
              <span class="text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{c.text}</span>
            </div>
            {#if pendingCommentDelete === c.id}
              <button
                class="text-[10px] px-1.5 py-0.5 rounded bg-rose-600 text-white"
                onclick={() => {
                  onDeleteComment(card.id, c.id);
                  pendingCommentDelete = null;
                }}
                title="Confirm delete"
              >
                Delete?
              </button>
              <button
                class="text-[10px] px-1 text-slate-500"
                onclick={() => (pendingCommentDelete = null)}
                title="Cancel"
              >
                ×
              </button>
            {:else}
              <button
                class="opacity-0 group-hover/c:opacity-100 focus:opacity-100 text-slate-400 hover:text-rose-500 transition"
                title="Delete comment"
                aria-label="Delete comment"
                onclick={() => (pendingCommentDelete = c.id)}
              >
                ✕
              </button>
            {/if}
          </div>
        {/each}
        <div class="flex gap-1 mt-1">
          <input
            bind:value={commentDraft}
            type="text"
            placeholder="Add a comment…"
            class="flex-1 text-xs border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400"
            onkeydown={onCommentKey}
            onfocus={() => onTypingComment(card.id)}
            onblur={() => onTypingComment(null)}
          />
          <button
            class="text-xs px-2 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded disabled:opacity-40"
            disabled={!commentDraft.trim()}
            onclick={submitComment}
          >
            Post
          </button>
        </div>
      </div>
    {/if}
  {/if}
</article>
