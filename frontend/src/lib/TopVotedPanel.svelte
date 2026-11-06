<script lang="ts">
  import { X } from 'lucide-svelte';
  import { COLUMN_STYLE, type ColumnColor } from './columns';

  // The ranked list a canvas uses in place of sorting: cards never move on their
  // own, so this is how the team finds what to talk about next.
  interface TopVotedRow {
    id: string;
    text: string;
    votes: number;
    color: ColumnColor;
  }

  interface Props {
    rows: TopVotedRow[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onClose: () => void;
  }

  let { rows, selectedId, onSelect, onClose }: Props = $props();
</script>

<section
  class="absolute top-3 left-3 z-10 w-72 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] flex flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 shadow-sm text-sm"
  aria-label="Top voted"
  data-testid="top-voted"
>
  <header class="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700">
    <h2 class="font-semibold text-slate-800 dark:text-slate-100">Top voted</h2>
    <button class="btn-ghost min-h-[28px] min-w-[28px] px-1 text-slate-500 dark:text-slate-400" onclick={onClose} aria-label="Close Top voted">
      <X size={14} aria-hidden="true" />
    </button>
  </header>
  {#if rows.length === 0}
    <p class="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">No votes yet.</p>
  {:else}
    <ol class="overflow-y-auto p-1">
      {#each rows as row (row.id)}
        <li>
          <button
            class="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 {selectedId === row.id ? 'bg-sky-50 dark:bg-sky-900/30' : ''}"
            aria-current={selectedId === row.id ? 'true' : undefined}
            onclick={() => onSelect(row.id)}
          >
            <span class="w-5 shrink-0 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200" aria-label={`${row.votes} ${row.votes === 1 ? 'vote' : 'votes'}`}>{row.votes}</span>
            <span class="mt-1.5 size-2 rounded-full shrink-0 {COLUMN_STYLE[row.color].dot}" aria-hidden="true"></span>
            <span class="min-w-0 line-clamp-2 text-slate-700 dark:text-slate-200">{row.text}</span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</section>
