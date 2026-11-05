<script lang="ts">
  import { tick } from 'svelte';

  // A heading (a column title or a group name). For anyone allowed to edit, it's
  // also a button that turns into an input to rename in place, like the board
  // name (BoardLabel). Enter or leaving the field saves, Escape cancels. A blank
  // value keeps the old one unless allowBlank is set.
  let {
    title,
    canEdit,
    onRename,
    inputLabel,
    hint,
    maxLength,
    display = title,
    allowBlank = false,
    tag = 'h2',
    headingClass = 'font-semibold tracking-tight text-slate-800 dark:text-slate-100 min-w-0',
    inputClass = 'input flex-1 min-w-0 px-2 py-0.5 text-sm font-semibold'
  } = $props<{
    title: string;
    canEdit: boolean;
    onRename: (next: string) => void;
    inputLabel: string;
    hint: string;
    maxLength: number;
    // What to show, when that differs from the stored value (an unnamed group).
    display?: string;
    allowBlank?: boolean;
    tag?: 'h2' | 'h3';
    headingClass?: string;
    inputClass?: string;
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
    if (save && (t || allowBlank) && t !== title) onRename(t);
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
    maxlength={maxLength}
    aria-label={inputLabel}
    onkeydown={onKey}
    onblur={() => finish(true)}
    class={inputClass}
  />
{:else}
  <svelte:element this={tag} class={headingClass}>
    {#if canEdit}
      <button
        bind:this={buttonEl}
        type="button"
        class="text-left rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 -mx-1 px-1 cursor-text"
        onclick={startEdit}
        title={hint}
      >
        {display}
      </button>
    {:else}
      {display}
    {/if}
  </svelte:element>
{/if}
