<script lang="ts">
  import { onMount } from 'svelte';
  import { Settings2, TriangleAlert, X } from 'lucide-svelte';
  import ColumnEditor, { type ColumnRow } from './ColumnEditor.svelte';
  import { ACTIONS_COLUMN_KEY, diffColumns, editColumns, hasActionsColumn, isActionsColumn, type ColumnDef } from './columns';
  import { BOARD_SETTING_KEYS, BOARD_SETTING_LABELS, type BoardSettings } from './settings';
  import type { BoardEdit } from './yboard';

  let {
    label,
    columns,
    settings,
    cardCounts,
    onClose,
    onSave
  } = $props<{
    // A snapshot of the board when the dialog opened. The host is the only
    // editor, so the dialog doesn't follow live changes while it's open.
    label: string;
    columns: ColumnDef[];
    settings: BoardSettings;
    cardCounts: Record<string, number>;
    onClose: () => void;
    onSave: (edit: Required<BoardEdit>) => void;
  }>();

  // svelte-ignore state_referenced_locally
  const initial: { label: string; columns: ColumnDef[]; settings: BoardSettings; cardCounts: Record<string, number> } = {
    label,
    columns,
    settings: { ...settings },
    cardCounts
  };

  let labelInput = $state(initial.label);
  let actionItems = $state(hasActionsColumn(initial.columns));
  let rows = $state<ColumnRow[]>(
    initial.columns
      .filter((c) => !isActionsColumn(c))
      .map((c, i) => ({ id: i, key: c.key, title: c.title, cards: initial.cardCounts[c.key] ?? 0 }))
  );
  let draftSettings = $state<BoardSettings>({ ...initial.settings });
  let nameEl = $state<HTMLInputElement | null>(null);

  const next = $derived(editColumns(initial.columns, rows, { actionItems }));
  const removedWithCards = $derived(
    next ? diffColumns(initial.columns, next).removed.filter((c) => (initial.cardCounts[c.key] ?? 0) > 0) : []
  );
  const deletedCards = $derived(removedWithCards.reduce((n, c) => n + initial.cardCounts[c.key], 0));

  onMount(() => nameEl?.focus());

  function cardsLabel(n: number): string {
    return `${n} card${n === 1 ? '' : 's'}`;
  }

  function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (!next) return;
    onSave({ label: labelInput, columns: next, settings: { ...draftSettings } });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
  onclick={onBackdrop}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="edit-board-heading"
    tabindex="-1"
    class="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-150"
  >
    <div class="flex items-start gap-3">
      <span
        class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 shrink-0"
        aria-hidden="true"
      >
        <Settings2 size={18} />
      </span>
      <div class="flex-1 min-w-0">
        <h2 id="edit-board-heading" class="text-lg font-semibold tracking-tight">Edit board</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Changes show up for everyone on the board as soon as you save.
        </p>
      </div>
      <button
        type="button"
        class="btn-ghost text-slate-500 dark:text-slate-400 -mr-2 -mt-1 min-h-[32px] min-w-[32px] px-1.5"
        onclick={onClose}
        aria-label="Close"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>

    <form class="mt-5" onsubmit={submit}>
      <label for="edit-board-name" class="text-xs font-medium text-slate-700 dark:text-slate-200">Retro name</label>
      <input
        bind:this={nameEl}
        bind:value={labelInput}
        id="edit-board-name"
        type="text"
        maxlength="60"
        autocomplete="off"
        placeholder="e.g. Sprint 42 — Mobile"
        class="mt-1 input w-full px-3 py-2.5 min-h-[44px] text-sm"
      />

      <fieldset class="mt-4 min-w-0">
        <legend class="text-xs font-medium text-slate-700 dark:text-slate-200">Columns</legend>
        <ColumnEditor
          bind:rows
          bind:actionItems
          idPrefix="edit-board-column"
          reorderable
          actionItemsCards={initial.cardCounts[ACTIONS_COLUMN_KEY] ?? 0}
        />
        {#if !next}
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Name at least one column.</p>
        {/if}
      </fieldset>

      <fieldset class="mt-4 min-w-0 space-y-2">
        <legend class="text-xs font-medium text-slate-700 dark:text-slate-200">Options</legend>
        {#each BOARD_SETTING_KEYS as key (key)}
          <label class="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input type="checkbox" bind:checked={draftSettings[key]} class="mt-0.5 rounded" />
            <span>
              {BOARD_SETTING_LABELS[key].label}
              <span class="block text-slate-500 dark:text-slate-400">{BOARD_SETTING_LABELS[key].hint}</span>
            </span>
          </label>
        {/each}
      </fieldset>

      {#if removedWithCards.length > 0}
        <div
          class="mt-4 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 p-3 text-xs text-rose-800 dark:text-rose-100"
          role="alert"
          data-testid="edit-board-warning"
        >
          <div class="flex items-start gap-2">
            <TriangleAlert size={14} class="shrink-0 mt-0.5" aria-hidden="true" />
            <ul class="space-y-0.5">
              {#each removedWithCards as c (c.key)}
                <li>Removing <em>{c.title}</em> deletes its {cardsLabel(initial.cardCounts[c.key])}.</li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}

      <div class="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={!next}
          class="flex-1 rounded-md py-2.5 min-h-[44px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 {deletedCards > 0
            ? 'bg-rose-600 text-white'
            : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'}"
        >
          {deletedCards > 0 ? `Save and delete ${cardsLabel(deletedCards)}` : 'Save'}
        </button>
        <button type="button" class="btn text-sm px-4 py-2 min-h-[44px]" onclick={onClose}>Cancel</button>
      </div>
    </form>
  </div>
</div>
