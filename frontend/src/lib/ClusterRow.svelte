<script lang="ts">
  import ClusterHeader from './ClusterHeader.svelte';
  import type { ClusterActions, ClusterLane } from './clusters';

  // What a group draws on the board's own grid in the aligned layout: a band
  // behind its title and cells, and the title itself. The band ignores the
  // pointer, and cards sit above it (z-index in BoardColumn).
  let {
    lane,
    titleRow,
    columnSpan,
    wide,
    canEdit,
    canMerge,
    mergeInto,
    clusterActions,
    highlighted,
    onDragOver,
    onDrop
  } = $props<{
    lane: ClusterLane;
    titleRow: number;
    // How many columns to span. Implicit grid tracks rule out `1 / -1` on wide boards.
    columnSpan: number;
    wide: boolean;
    canEdit: boolean;
    canMerge: boolean;
    mergeInto: string;
    clusterActions: ClusterActions;
    highlighted: boolean;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  }>();

  const place = $derived(`grid-column: 1 / span ${columnSpan}; scroll-snap-align: none;`);
</script>

<div
  aria-hidden="true"
  class="pointer-events-none relative z-[1] rounded-lg border transition-colors {highlighted
    ? 'border-violet-500 ring-2 ring-violet-300 dark:ring-violet-700 bg-violet-500/10'
    : 'border-violet-300 dark:border-violet-700 bg-violet-500/5 dark:bg-violet-400/5'}"
  style="{place} grid-row: {titleRow} / span 2;"
></div>
<div
  role="presentation"
  class="relative z-[2] rounded-t-lg bg-violet-100/70 dark:bg-violet-900/30 px-2 py-1 has-[[role=alertdialog]]:z-30"
  style="{place} grid-row: {titleRow};"
  data-testid="group-row"
  ondragover={onDragOver}
  ondrop={onDrop}
>
  <!-- On a wide board the row scrolls with the columns, so the name and its
       controls stick to the left edge to stay readable. -->
  <div class={wide ? 'sticky left-2 w-fit max-w-[min(32rem,calc(100vw-4rem))]' : ''}>
    <ClusterHeader
      {lane}
      {canEdit}
      {canMerge}
      {mergeInto}
      onRename={(label: string) => clusterActions.rename(lane.cluster.id, label)}
      onDissolve={() => clusterActions.dissolve(lane.cluster.id)}
      onMerge={() => clusterActions.merge(lane.cluster.id)}
    />
  </div>
</div>
