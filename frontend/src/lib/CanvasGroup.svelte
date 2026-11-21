<script lang="ts">
  import type { Snippet } from 'svelte';
  import { GripHorizontal } from 'lucide-svelte';
  import ClusterHeader from './ClusterHeader.svelte';
  import { CARD_WIDTH } from './canvas';
  import { GROUP_GAP, GROUP_PADDING, groupColumns } from './canvasGroups';
  import type { LiveMoves } from './canvasLive';
  import type { ClusterActions, ClusterLane } from './clusters';

  // A group on the canvas: one positioned box that holds its cards. The browser
  // lays the cards out inside it, so the frame always fits them, including a
  // card with its comments open. The box is the thing that moves; its cards'
  // own positions are ignored until they leave.
  interface Props {
    lane: ClusterLane;
    x: number;
    y: number;
    rank: number;
    live: LiveMoves;
    canEdit: boolean;
    canMerge: boolean;
    // Brainstorm: the box shows, its name doesn't.
    nameHidden: boolean;
    mergeInto: string;
    // A card being dragged would join this group if dropped now.
    highlighted: boolean;
    clusterActions: ClusterActions;
    children: Snippet;
  }
  let { lane, x, y, rank, live, canEdit, canMerge, nameHidden, mergeInto, highlighted, clusterActions, children }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  const id = $derived(lane.cluster.id);
  const cols = $derived(groupColumns(lane.count));

  $effect(() => {
    if (!el) return;
    const groupId = id;
    live.register(groupId, el);
    return () => live.unregister(groupId);
  });
  $effect(() => {
    live.setDocPos(id, { x, y });
  });
</script>

<div
  bind:this={el}
  class="canvas-group absolute top-0 left-0 rounded-xl border-2 border-dashed transition-colors {highlighted
    ? 'border-violet-500 bg-violet-200/70 dark:bg-violet-900/50 ring-4 ring-violet-300 dark:ring-violet-700'
    : 'border-violet-300 dark:border-violet-700 bg-violet-100/60 dark:bg-violet-900/20'}"
  style:padding="{GROUP_PADDING}px"
  style:z-index={rank}
  data-canvas-group={id}
  data-testid="canvas-group"
  data-drop-target={highlighted ? '' : undefined}
>
  <div class="flex items-start gap-1 cursor-grab">
    <GripHorizontal size={14} class="mt-1.5 shrink-0 text-violet-400 dark:text-violet-500" aria-hidden="true" />
    <div class="flex-1 min-w-0">
      <ClusterHeader
        {lane}
        {canEdit}
        {canMerge}
        {mergeInto}
        {nameHidden}
        surface="canvas"
        onRename={(label: string) => clusterActions.rename(id, label)}
        onDissolve={() => clusterActions.dissolve(id)}
        onMerge={() => clusterActions.merge(id)}
      />
    </div>
  </div>
  <div class="grid items-start mt-1" style:gap="{GROUP_GAP}px" style:grid-template-columns="repeat({cols}, {CARD_WIDTH}px)">
    {@render children()}
  </div>
</div>
