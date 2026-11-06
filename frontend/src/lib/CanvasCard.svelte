<script lang="ts">
  import Card from './Card.svelte';
  import HiddenCard from './HiddenCard.svelte';
  import { CARD_WIDTH } from './canvas';
  import { COLUMN_STYLE, type ColumnDef } from './columns';
  import type { LiveMoves } from './canvasLive';
  import type { CardActions } from './cardActions';
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
    userId: string;
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
  }

  let {
    card,
    column,
    x,
    y,
    rank,
    hidden,
    live,
    userId,
    userName,
    isLead,
    readOnly,
    canVote,
    anonymous,
    namesMap,
    cardActions,
    typers,
    highlighted
  }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  const id = $derived(card.id);

  $effect(() => {
    if (!el) return;
    const cardId = id;
    live.register(cardId, el);
    return () => live.unregister(cardId);
  });

  $effect(() => {
    live.setDocPos(id, { x, y });
  });
</script>

<div
  bind:this={el}
  class="canvas-card absolute top-0 left-0 rounded-xl border p-1 {COLUMN_STYLE[column.color].accent} {highlighted ? 'ring-4 ring-sky-400' : ''}"
  style:width="{CARD_WIDTH}px"
  style:z-index={rank}
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
      {userId}
      {userName}
      {isLead}
      {readOnly}
      {canVote}
      {anonymous}
      {namesMap}
      surface="canvas"
      {cardActions}
    />
    {#if typers.length > 0}
      <div class="text-[11px] text-slate-500 dark:text-slate-400 italic pl-1 mt-0.5" aria-live="polite">
        {typers.join(', ')} typing…
      </div>
    {/if}
  {/if}
</div>
