<script lang="ts" module>
  // One editable row. `key` is set for a column that already exists on a
  // board (so renaming keeps its cards); new rows have none. `cards` is how
  // many cards the existing column holds, for the removal warning.
  export interface ColumnRow {
    id: number;
    title: string;
    key?: string;
    cards?: number;
  }

  export function nextRowId(rows: ColumnRow[]): number {
    return rows.reduce((m, r) => Math.max(m, r.id), -1) + 1;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { ArrowDown, ArrowUp, Plus, X } from 'lucide-svelte';
  import { MAX_COLUMN_TITLE_LEN, MAX_INPUT_COLUMNS } from './columns';

  let {
    rows = $bindable(),
    actionItems = $bindable(),
    idPrefix,
    reorderable = false,
    actionItemsCards = 0
  } = $props<{
    rows: ColumnRow[];
    actionItems: boolean;
    // Row inputs get `${idPrefix}-${row.id}` so callers and tests can find them.
    idPrefix: string;
    // Move up/down buttons, for editing an existing board.
    reorderable?: boolean;
    // Cards in the board's Action items column, for the removal warning.
    actionItemsCards?: number;
  }>();

  async function addRow() {
    if (rows.length >= MAX_INPUT_COLUMNS) return;
    const id = nextRowId(rows);
    rows.push({ id, title: '' });
    await tick();
    document.getElementById(`${idPrefix}-${id}`)?.focus();
  }

  function removeRow(id: number) {
    if (rows.length <= 1) return;
    rows = rows.filter((r: ColumnRow) => r.id !== id);
  }

  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    rows = next;
  }

  function cardsLabel(n: number): string {
    return `${n} card${n === 1 ? '' : 's'}`;
  }
</script>

<ol class="mt-2 space-y-1.5 max-h-60 overflow-y-auto pr-1" aria-label="Custom columns">
  {#each rows as row, i (row.id)}
    <li class="flex items-center gap-1.5">
      <input
        id={`${idPrefix}-${row.id}`}
        bind:value={row.title}
        type="text"
        maxlength={MAX_COLUMN_TITLE_LEN}
        autocomplete="off"
        placeholder={i === 0 ? 'e.g. How might we speed up onboarding?' : `Column ${i + 1}`}
        aria-label={`Column ${i + 1} name`}
        class="input flex-1 min-w-0 px-2.5 py-2 text-sm"
      />
      {#if row.cards}
        <span class="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap" title="Cards in this column">
          {cardsLabel(row.cards)}
        </span>
      {/if}
      {#if reorderable}
        <button
          type="button"
          class="btn-ghost text-slate-500 dark:text-slate-400 min-h-[32px] min-w-[28px] px-1"
          onclick={() => move(i, -1)}
          disabled={i === 0}
          aria-label={`Move column ${i + 1} up`}
        >
          <ArrowUp size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="btn-ghost text-slate-500 dark:text-slate-400 min-h-[32px] min-w-[28px] px-1"
          onclick={() => move(i, 1)}
          disabled={i === rows.length - 1}
          aria-label={`Move column ${i + 1} down`}
        >
          <ArrowDown size={14} aria-hidden="true" />
        </button>
      {/if}
      <button
        type="button"
        class="btn-ghost text-slate-500 dark:text-slate-400 min-h-[32px] min-w-[32px] px-1.5"
        onclick={() => removeRow(row.id)}
        disabled={rows.length <= 1}
        aria-label={`Remove column ${i + 1}`}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  {/each}
  <li>
    <label class="flex items-start gap-2 px-2.5 py-2 text-sm rounded-md border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 cursor-pointer select-none">
      <input type="checkbox" bind:checked={actionItems} class="mt-0.5 rounded" />
      <span class="flex-1">
        Action items column
        <span class="block text-xs text-slate-500 dark:text-slate-400">Filled in during a final Actions phase. Leave it off to end at Discuss.</span>
      </span>
      {#if actionItemsCards}
        <span class="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">{cardsLabel(actionItemsCards)}</span>
      {/if}
    </label>
  </li>
</ol>
{#if rows.length < MAX_INPUT_COLUMNS}
  <button type="button" class="btn-ghost mt-1.5 text-xs px-2 py-1" onclick={addRow}>
    <Plus size={14} aria-hidden="true" />
    Add column
  </button>
{/if}
