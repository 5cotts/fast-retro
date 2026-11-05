<script lang="ts">
  import { Ungroup } from 'lucide-svelte';
  import EditableHeading from './EditableHeading.svelte';
  import { clusterDisplayName, MAX_CLUSTER_LABEL_LEN, type ClusterLane } from './clusters';

  // A group's name, counts and controls.
  let {
    lane,
    canEdit,
    onRename,
    onDissolve
  } = $props<{
    lane: ClusterLane;
    canEdit: boolean;
    onRename: (label: string) => void;
    onDissolve: () => void;
  }>();
</script>

<div class="flex items-center gap-1.5 flex-wrap px-1 min-h-[28px]">
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
</div>
