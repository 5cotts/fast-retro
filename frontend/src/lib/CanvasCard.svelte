<script lang="ts">
  import Card from './Card.svelte';
  import CardGroupMenu from './CardGroupMenu.svelte';
  import type { ClusterActions, ClusterDef } from './clusters';
  import HiddenCard from './HiddenCard.svelte';
  import { CARD_WIDTH } from './canvas';
  import { COLUMN_STYLE, type ColumnDef } from './columns';
  import type { LiveMoves } from './canvasLive';
  import type { CardActions } from './cardActions';
  import type { Viewer } from './viewer';
  import type { CardData } from './types';

  // Places one card on the canvas. Its position is written to the element by
  // LiveMoves, which also draws live drags; the surface handles the gestures,
  // finding the card through data-canvas-card.
  interface Props {
    card: CardData;
    column: ColumnDef;
    x: number;
    y: number;
    rank: number;
    hidden: boolean;
    live: LiveMoves;
    viewer: Viewer;
    userName: string;
    isLead: boolean;
    readOnly: boolean;
    canVote: boolean;
    anonymous: boolean;
    namesMap: Record<string, string>;
    cardActions: CardActions;
    typers: string[];
    // Just picked in Top voted.
    highlighted: boolean;
    // The group this card is drawn inside, if any. Then it sits in the box's
    // layout and its own position is ignored.
    groupId?: string | null;
    // Every group, for the card's Group menu.
    groups?: ClusterDef[];
    canGroup?: boolean;
    // A card being dragged would group with this one if dropped now.
    isGroupTarget?: boolean;
    clusterActions?: ClusterActions;
  }

  let {
    card,
    column,
    x,
    y,
    rank,
    hidden,
    live,
    viewer,
    userName,
    isLead,
    readOnly,
    canVote,
    anonymous,
    namesMap,
    cardActions,
    typers,
    highlighted,
    groupId = null,
    groups = [],
    canGroup = false,
    isGroupTarget = false,
    clusterActions
  }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  const id = $derived(card.id);

  $effect(() => {
    if (!el) return;
    const cardId = id;
    const node = el;
    const inGroup = groupId;
    live.register(
      cardId,
      node,
      inGroup
        ? () => {
            // Where the box's top-left corner is now, plus the card's place in it.
            const g = live.shownAt(inGroup);
            const box = node.offsetParent as HTMLElement | null;
            return g && box
              ? { x: g.x + box.clientLeft + node.offsetLeft, y: g.y + box.clientTop + node.offsetTop }
              : null;
          }
        : undefined
    );
    return () => live.unregister(cardId);
  });

  $effect(() => {
    if (!groupId) live.setDocPos(id, { x, y });
  });
</script>

<div
  bind:this={el}
  class="canvas-card {groupId ? 'relative' : 'absolute top-0 left-0'} rounded-xl border p-1 {COLUMN_STYLE[column.color].accent} {highlighted ? 'ring-4 ring-sky-400' : ''}"
  style:width="{CARD_WIDTH}px"
  style:z-index={groupId ? undefined : rank}
  data-canvas-card={id}
  data-column={column.key}
  data-color={column.color}
  data-testid="canvas-card"
  data-highlighted={highlighted ? '' : undefined}
>
  {#if hidden}
    <HiddenCard />
  {:else}
    <Card
      {card}
      column={column.key}
      {viewer}
      {userName}
      {isLead}
      {readOnly}
      {canVote}
      {anonymous}
      {namesMap}
      surface="canvas"
      {isGroupTarget}
      {cardActions}
    >
      {#snippet actions()}
        {#if canGroup && clusterActions}
          <CardGroupMenu
            {groups}
            currentId={groupId}
            onJoin={(g: string) => clusterActions.join(column.key, card.id, g)}
            onCreate={(label: string) => clusterActions.create(column.key, card.id, label)}
            onLeave={() => clusterActions.leave(column.key, card.id)}
          />
        {/if}
      {/snippet}
    </Card>
    {#if typers.length > 0}
      <div class="text-[11px] text-slate-500 dark:text-slate-400 italic pl-1 mt-0.5" aria-live="polite">
        {typers.join(', ')} typing…
      </div>
    {/if}
  {/if}
</div>
