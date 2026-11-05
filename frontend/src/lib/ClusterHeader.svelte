<script lang="ts">
  import { Combine, Ungroup } from 'lucide-svelte';
  import EditableHeading from './EditableHeading.svelte';
  import { clusterDisplayName, MAX_CLUSTER_LABEL_LEN, type ClusterLane } from './clusters';

  // A group's name, counts and controls.
  let {
    lane,
    canEdit,
    canMerge,
    mergeInto,
    onRename,
    onDissolve,
    onMerge
  } = $props<{
    lane: ClusterLane;
    canEdit: boolean;
    canMerge: boolean;
    // The title of the column the merged card ends up in.
    mergeInto: string;
    onRename: (label: string) => void;
    onDissolve: () => void;
    onMerge: () => void;
  }>();

  let confirmingMerge = $state(false);
</script>

<div class="flex items-center gap-x-2 gap-y-0.5 flex-wrap px-1 min-h-[28px]">
  <div class="flex-1 min-w-0 flex">
    <EditableHeading
      title={lane.cluster.label}
      display={clusterDisplayName(lane.cluster)}
      {canEdit}
      {onRename}
      inputLabel="Group name"
      hint="Click to rename this group"
      maxLength={MAX_CLUSTER_LABEL_LEN}
      allowBlank
      tag="h3"
      headingClass="text-xs font-semibold text-slate-700 dark:text-slate-200 min-w-0 break-words {lane.cluster.label ? '' : 'italic font-medium text-slate-500 dark:text-slate-400'}"
      inputClass="input flex-1 min-w-0 px-1.5 py-0.5 text-xs font-semibold"
    />
  </div>
  <span class="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
    {lane.count} {lane.count === 1 ? 'card' : 'cards'}{#if lane.voters > 0}&nbsp;· {lane.voters} {lane.voters === 1 ? 'voter' : 'voters'}{/if}
  </span>
  {#if canEdit}
    <button
      type="button"
      class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded px-1 py-1 hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      aria-label={`Ungroup ${clusterDisplayName(lane.cluster)}`}
      title="Ungroup. Every card stays in its column."
      onclick={onDissolve}
    >
      <Ungroup size={12} aria-hidden="true" />
      Ungroup
    </button>
  {/if}
  {#if canMerge && lane.count > 1}
    <button
      type="button"
      class="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded px-1 py-1 hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      aria-label={`Merge ${clusterDisplayName(lane.cluster)}`}
      title="Combine these cards into one card"
      onclick={() => (confirmingMerge = true)}
    >
      <Combine size={12} aria-hidden="true" />
      Merge
    </button>
  {/if}
</div>
{#if confirmingMerge}
  <div
    class="p-2 rounded-md border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 text-xs"
    role="alertdialog"
    aria-label="Confirm merge"
  >
    <p class="text-rose-800 dark:text-rose-100">
      {lane.count} cards become one card in {mergeInto}. Votes, reactions and comments are kept. This can't be undone.
    </p>
    <div class="mt-2 flex items-center gap-2">
      <button
        class="btn-danger px-2.5 py-1"
        onclick={() => {
          confirmingMerge = false;
          onMerge();
        }}
      >
        Merge cards
      </button>
      <button class="btn-ghost px-2.5 py-1" onclick={() => (confirmingMerge = false)}>Cancel</button>
    </div>
  </div>
{/if}
