<script lang="ts">
  import BoardColumn from './BoardColumn.svelte';
  import { canAddCardInColumn, canVoteInPhase, type Phase } from './phase';
  import type { CardActions } from './cardActions';
  import type { ClusterActions } from './clusters';
  import type { ColumnDef } from './columns';
  import type { Viewer } from './viewer';
  import type { CardData } from './types';

  // Action items on a canvas board: the ordinary column, docked beside the
  // canvas. These cards aren't placed anywhere, so nothing here drags or groups.
  interface Props {
    column: ColumnDef;
    cards: CardData[];
    phase: Phase;
    ended: boolean;
    viewer: Viewer;
    userName: string;
    isLead: boolean;
    anonymous: boolean;
    hideCards: boolean;
    namesMap: Record<string, string>;
    typingByCard: Map<string, string[]>;
    reducedMotion: boolean;
    coarsePointer: boolean;
    cardActions: CardActions;
    onRename: (title: string) => void;
  }

  let {
    column,
    cards,
    phase,
    ended,
    viewer,
    userName,
    isLead,
    anonymous,
    hideCards,
    namesMap,
    typingByCard,
    reducedMotion,
    coarsePointer,
    cardActions,
    onRename
  }: Props = $props();

  const noClusters: ClusterActions = {
    join() {},
    create() {},
    leave() {},
    rename() {},
    dissolve() {},
    merge() {}
  };
  const noop = () => {};
</script>

<aside
  class="shrink-0 w-full md:w-80 max-h-[45%] md:max-h-none overflow-y-auto border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2"
  aria-label={column.title}
  data-testid="canvas-dock"
>
  <BoardColumn
    {column}
    {cards}
    lanes={[]}
    cardCount={cards.length}
    aligned={false}
    columnIndex={0}
    canCluster={false}
    canMerge={false}
    mergeTitle={() => ''}
    clusterActions={noClusters}
    canAdd={canAddCardInColumn(column, phase) && !ended}
    {phase}
    {viewer}
    {userName}
    {isLead}
    readOnly={ended}
    canVote={canVoteInPhase(phase)}
    {anonymous}
    {namesMap}
    canReorder={false}
    {hideCards}
    dragCardId={null}
    dragCanGroup={false}
    dragIsGrouped={false}
    dropTarget={null}
    {typingByCard}
    {reducedMotion}
    {coarsePointer}
    {cardActions}
    onCardKeydown={noop}
    onFocusCard={noop}
    onDragStart={noop}
    onDragEnd={noop}
    onTargetDragOver={noop}
    onColumnDragOver={noop}
    onColumnDrop={noop}
    {onRename}
  />
</aside>
