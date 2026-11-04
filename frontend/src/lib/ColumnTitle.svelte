<script lang="ts">
  import { tick } from 'svelte';
  import { MAX_COLUMN_TITLE_LEN } from './columns';

  // A column's heading. For the host it's also a button that turns into an
  // input to rename the column in place, like the board name (BoardLabel).
  // Enter or leaving the field saves, Escape cancels, a blank title keeps the
  // old one.
  let {
    title,
    canEdit,
    onRename
  } = $props<{
    title: string;
    canEdit: boolean;
    onRename: (next: string) => void;
  }>();

  let editing = $state(false);
  let value = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let buttonEl = $state<HTMLButtonElement | null>(null);

  async function startEdit() {
    value = title;
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  async function finish(save: boolean) {
    if (!editing) return;
    editing = false;
    const t = value.trim();
    if (save && t && t !== title) onRename(t);
    await tick();
    buttonEl?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  }
</script>

{#if canEdit && editing}
  <input
    bind:this={inputEl}
    bind:value
    type="text"
    maxlength={MAX_COLUMN_TITLE_LEN}
    aria-label="Column name"
    onkeydown={onKey}
    onblur={() => finish(true)}
    class="input flex-1 min-w-0 px-2 py-0.5 text-sm font-semibold"
  />
{:else}
  <h2 class="font-semibold tracking-tight text-slate-800 dark:text-slate-100 min-w-0">
    {#if canEdit}
      <button
        bind:this={buttonEl}
        type="button"
        class="text-left rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 -mx-1 px-1 cursor-text"
        onclick={startEdit}
        title="Click to rename this column"
      >
        {title}
      </button>
    {:else}
      {title}
    {/if}
  </h2>
{/if}
