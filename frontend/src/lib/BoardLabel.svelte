<script lang="ts">
  import { Pencil, Check, X } from 'lucide-svelte';

  let {
    label,
    slug,
    canEdit,
    onSave
  } = $props<{
    label: string;
    slug: string;
    canEdit: boolean;
    onSave: (next: string) => void;
  }>();

  let editing = $state(false);
  let value = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  function startEdit() {
    value = label;
    editing = true;
  }

  $effect(() => {
    if (editing) {
      inputEl?.focus();
      inputEl?.select();
    }
  });

  function commit() {
    const t = value.trim().slice(0, 60);
    if (t !== label) onSave(t);
    editing = false;
  }

  function cancel() {
    editing = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  const displayLabel = $derived(label || '');
</script>

<div class="flex items-center gap-1.5 min-w-0">
  <span class="hidden sm:inline text-slate-300 dark:text-slate-700 select-none" aria-hidden="true">|</span>

  {#if editing}
    <input
      bind:this={inputEl}
      bind:value
      type="text"
      maxlength="60"
      placeholder="Name this retro"
      aria-label="Board name"
      onkeydown={onKey}
      onblur={commit}
      class="input text-sm px-2 py-0.5 min-h-[32px] w-44 sm:w-56"
    />
    <button
      type="button"
      class="btn-ghost min-h-[32px] min-w-[32px] px-1.5"
      onclick={commit}
      aria-label="Save board name"
    >
      <Check size={14} aria-hidden="true" />
    </button>
    <button
      type="button"
      class="btn-ghost min-h-[32px] min-w-[32px] px-1.5"
      onclick={cancel}
      aria-label="Cancel"
    >
      <X size={14} aria-hidden="true" />
    </button>
  {:else if displayLabel}
    {#if canEdit}
      <button
        type="button"
        class="group inline-flex items-center gap-1.5 min-w-0 max-w-[14rem] sm:max-w-sm rounded px-1 -mx-1 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 transition-colors"
        onclick={startEdit}
        title="Rename this retro"
        aria-label={`Board: ${displayLabel}. Click to rename.`}
      >
        <span class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
          {displayLabel}
        </span>
        <Pencil size={11} aria-hidden="true" class="opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
      </button>
    {:else}
      <span
        class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate max-w-[14rem] sm:max-w-sm"
        title={displayLabel}
      >
        {displayLabel}
      </span>
    {/if}
    <span class="hidden md:inline text-xs text-slate-400 dark:text-slate-500 font-mono shrink-0" title="Board slug">
      {slug}
    </span>
  {:else if canEdit}
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded px-1 -mx-1 focus:outline-none focus:ring-2 focus:ring-sky-400 transition-colors"
      onclick={startEdit}
      title="Name this retro so it's easier to find later"
      aria-label="Name this retro"
    >
      <Pencil size={12} aria-hidden="true" />
      <span class="italic">Name this retro</span>
    </button>
  {:else}
    <span class="text-xs text-slate-400 dark:text-slate-500 font-mono truncate max-w-[10rem]" title="Board slug">
      {slug}
    </span>
  {/if}
</div>
