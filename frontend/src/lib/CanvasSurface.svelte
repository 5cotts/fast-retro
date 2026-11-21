<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { ListOrdered, Maximize, Minus, Plus } from 'lucide-svelte';
  import CanvasCard from './CanvasCard.svelte';
  import CanvasGroup from './CanvasGroup.svelte';
  import CanvasComposer from './CanvasComposer.svelte';
  import CanvasDock from './CanvasDock.svelte';
  import CanvasDraftCard from './CanvasDraftCard.svelte';
  import CanvasLabel from './CanvasLabel.svelte';
  import CanvasLabelInput from './CanvasLabelInput.svelte';
  import TopVotedPanel from './TopVotedPanel.svelte';
  import EditableHeading from './EditableHeading.svelte';
  import {
    CARD_SLOT_HEIGHT,
    CARD_WIDTH,
    DEFAULT_VIEW,
    HEADING_HEIGHT,
    MIN_FIT_SLOTS,
    boundsOf,
    cardSlotHeight,
    overlapsAny,
    centerOn,
    compareStack,
    fitToBounds,
    gridSlots,
    headingPosition,
    nextZ,
    panToReveal,
    sanitizePos,
    screenToWorld,
    zoomAt,
    type Point,
    type Rect,
    type View
  } from './canvas';
  import { DRAG_FRAME_MS, DRAG_HEARTBEAT_MS, LiveMoves, parseDragFrame } from './canvasLive';
  import { freeSpotBeside, groupBoxSize, planCanvasDrop, topVotedItems, type DropOver } from './canvasGroups';
  import { createCluster, dissolveCluster, mergeCluster, moveCard, renameCluster, setCardCluster, setCardPos, setClusterPos } from './yboard';
  import { track } from './analytics';
  import { canEditClusters, clusterDisplayName, clustersVisible, layoutBoard, type ClusterActions, type ClusterLane } from './clusters';
  import { MAX_LABELS, createLabel, deleteLabel, editLabel, labelRect, moveLabel } from './labels';
  import { COLUMN_STYLE, MAX_COLUMN_TITLE_LEN, isActionsColumn, type ColumnDef } from './columns';
  import { canAddCardInColumn, canVoteInPhase } from './phase';
  import { isCardHidden } from './visibility';
  import type { CardActions } from './cardActions';
  import type { Viewer } from './viewer';
  import type { CardData } from './types';
  import type { UseBoardConnectionState } from './useBoardConnection.svelte';

  // The canvas view of a board: cards placed freely on a pannable, zoomable
  // world. Pan and zoom are each person's own and never go in the doc. Board
  // keeps the connection, header, phases and end flow.
  interface Props {
    board: UseBoardConnectionState;
    cardActions: CardActions;
    ended: boolean;
    viewer: Viewer;
    userName: string;
    // Already false once the board has ended.
    isLead: boolean;
    namesMap: Record<string, string>;
    typingByCard: Map<string, string[]>;
    reducedMotion: boolean;
    coarsePointer: boolean;
    onRenameColumn: (key: string, title: string) => void;
  }

  let {
    board,
    cardActions,
    ended,
    viewer,
    userName,
    isLead,
    namesMap,
    typingByCard,
    reducedMotion,
    coarsePointer,
    onRenameColumn
  }: Props = $props();

  interface Placed {
    card: CardData;
    column: ColumnDef;
    x: number;
    y: number;
    z: number;
    height: number;
    hidden: boolean;
    // The group this card is drawn inside, if any. Then x and y are ignored.
    groupId: string | null;
  }

  // Start a card drag only after this much movement, so a click stays a click.
  const DRAG_THRESHOLD_PX = 4;
  const NUDGE_WORLD_PX = 20;
  const WHEEL_ZOOM_SPEED = 0.01;
  const BUTTON_ZOOM_STEP = 1.25;
  const WHEEL_LINE_PX = 16;
  // A mouse notch reports about 100 where a trackpad pinch reports a few, so
  // without a cap one notch would zoom out by 70%.
  const MAX_WHEEL_ZOOM_DELTA = 25;
  // Never start a drag or a pan from these, and let them scroll themselves.
  const INTERACTIVE = 'button, a, input, textarea, select, label, summary, [role="menu"], [role="menuitem"], [contenteditable="true"]';
  const OWN_SCROLLER = '[role="menu"], textarea';
  // How far above the pointer a new label's top edge sits.
  const LABEL_GRAB_Y = 16;

  let view = $state<View>(DEFAULT_VIEW);
  let viewportEl = $state<HTMLElement | null>(null);
  // Only during a gesture: left on, it would rasterize text at the current zoom.
  let gesturing = $state(false);
  const live = new LiveMoves();

  const canVote = $derived(canVoteInPhase(board.phase));

  // Action items never sit on the canvas: they're docked beside it.
  const prompts = $derived(board.columns.filter((c) => !isActionsColumn(c)));
  const actionsColumn = $derived(board.columns.find(isActionsColumn) ?? null);
  const actionCards = $derived(actionsColumn ? (board.cards[actionsColumn.key] ?? []) : []);
  // Hidden until it's useful, unless carried-over items are waiting in it.
  const showDock = $derived(
    actionsColumn !== null && (board.phase === 'actions' || ended || actionCards.length > 0)
  );

  const canAdd = $derived(!ended && prompts.length > 0 && canAddCardInColumn(prompts[0], board.phase));
  let selectedPrompt = $state<string | null>(null);
  // The selection falls back if the host removes that prompt.
  const activePrompt = $derived(prompts.find((p) => p.key === selectedPrompt) ?? prompts[0]);

  // The same groups a column board has, drawn as boxes. They're always laid
  // out, even in Brainstorm, where only the name is hidden: hiding the box would
  // send grouped cards back to where they sat before they were grouped.
  const canGroup = $derived(canEditClusters(board.phase, ended));
  const groupNamesShown = $derived(clustersVisible(board.phase, ended));
  const groupLayout = $derived(layoutBoard(prompts, board.cards, board.clusters, { showClusters: true, sortByVotes: false }));
  const laneOf = $derived.by(() => {
    const m = new Map<string, string>();
    for (const lane of groupLayout.lanes) for (const list of Object.values(lane.cards)) for (const c of list) m.set(c.id, lane.cluster.id);
    return m;
  });
  const clusterPos = $derived(new Map(board.clusters.filter((c) => c.pos).map((c) => [c.id, c.pos!])));

  const grid = $derived.by(() => {
    const cards: Placed[] = [];
    const nextSlot = new Map<string, Point>();
    const seen = new Set<string>();
    const rules = { hideCards: board.settings.hideCards, phase: board.phase, ended, viewer };
    prompts.forEach((column, columnIndex) => {
      const list = board.cards[column.key] ?? [];
      const hidden = list.map((card) => isCardHidden(card, column, rules));
      // A placeholder's height mustn't give away how long the card is.
      const heights = list.map((card, i) => (hidden[i] ? CARD_SLOT_HEIGHT : cardSlotHeight(card.text)));
      const slots = gridSlots(columnIndex, heights);
      nextSlot.set(column.key, slots[list.length]);
      list.forEach((card, i) => {
        if (seen.has(card.id)) return;
        seen.add(card.id);
        const groupId = laneOf.get(card.id) ?? null;
        // The last card left in an unnamed group stays where the group was.
        const lone = !groupId && card.clusterId ? clusterPos.get(card.clusterId) : undefined;
        const at = lone ?? card.pos ?? slots[i];
        cards.push({ card, column, x: at.x, y: at.y, z: card.pos?.z ?? 0, height: heights[i], hidden: hidden[i], groupId });
      });
    });
    return { cards, nextSlot };
  });
  const placed = $derived(grid.cards);
  const looseCards = $derived(placed.filter((p) => !p.groupId));
  // A group that was never placed (made on a column board or in List view) sits
  // where its first card is.
  const groups = $derived(
    groupLayout.lanes.map((lane) => {
      const members = placed.filter((p) => p.groupId === lane.cluster.id);
      const at = lane.cluster.pos ?? { x: members[0]?.x ?? 0, y: members[0]?.y ?? 0, z: 0 };
      return { lane, members, x: at.x, y: at.y, z: at.z, placed: lane.cluster.pos !== undefined };
    })
  );
  type Group = (typeof groups)[number];
  const groupOptions = $derived(groupLayout.lanes.map((l) => l.cluster));
  // What a card being dragged would land on, as `card:<id>` or `group:<id>`.
  let dropHover = $state<string | null>(null);

  function mergeTitle(lane: ClusterLane): string {
    return prompts.find((c) => (lane.cards[c.key]?.length ?? 0) > 0)?.title ?? '';
  }

  // Where a card is on the canvas right now, whether it's loose or in a group.
  function worldRectOf(cardId: string): Rect | null {
    const el = viewportEl?.querySelector<HTMLElement>(`[data-canvas-card="${CSS.escape(cardId)}"]`);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const at = screenToWorld(view, pointIn({ clientX: box.left, clientY: box.top }));
    return { ...at, width: box.width / view.zoom, height: box.height / view.zoom };
  }

  // A box's size is measured when it's on screen, and estimated otherwise.
  function groupRect(g: Group): Rect {
    const el = viewportEl?.querySelector<HTMLElement>(`[data-canvas-group="${CSS.escape(g.lane.cluster.id)}"]`);
    const size = el ? { width: el.offsetWidth, height: el.offsetHeight } : groupBoxSize(g.members.map((m) => m.height));
    return { x: g.x, y: g.y, ...size };
  }

  // Everything a card could land on top of.
  function obstacles(except?: Group): Rect[] {
    return [
      ...looseCards.map((p) => ({ x: p.x, y: p.y, width: CARD_WIDTH, height: p.height })),
      ...groups.filter((g) => g !== except).map(groupRect)
    ];
  }

  // Boxes and cards share one stacking order, so the next z is above both.
  function topZ(): number {
    return nextZ([...placed.map((p) => p.card.pos), ...groups.map((g) => ({ x: 0, y: 0, z: g.z }))]);
  }

  // A group's place is derived from its first card until it's stored. Membership
  // changes would move that card, and the box with it, so write the place down
  // first. Call inside the same transaction as the change.
  function pinGroup(clusterId: string) {
    const state = board.board;
    const group = groups.find((g) => g.lane.cluster.id === clusterId);
    if (state && group && !group.placed) setClusterPos(state.clusters, clusterId, { x: group.x, y: group.y, z: group.z });
  }

  function groupOf(cardId: string): Group | undefined {
    return groups.find((g) => g.members.some((m) => m.card.id === cardId));
  }

  // The prompts a card could move to. Keeping its position and group, it only
  // takes the new prompt's color and heading, so nothing on the canvas moves.
  function movesFor(columnKey: string) {
    return prompts.filter((c) => c.key !== columnKey).map((c) => ({ key: c.key, title: c.title }));
  }

  function moveToPrompt(fromColumn: string, cardId: string, toColumn: string) {
    const state = board.board;
    if (!state || ended || fromColumn === toColumn) return;
    const hit = placedById(cardId);
    state.doc.transact(() => {
      // A card still in its starting slot would otherwise take the next slot in
      // the new prompt. Write down where it is so it stays put.
      if (hit && !hit.card.pos && !hit.groupId) setCardPos(state.board, fromColumn, cardId, { x: hit.x, y: hit.y, z: 0 });
      moveCard(state.doc, state.board, fromColumn, cardId, toColumn, null);
    });
    track({ name: 'canvas_move_prompt', params: {} });
  }

  const clusterActions: ClusterActions = {
    join(column, cardId, clusterId) {
      const state = board.board;
      if (!state) return;
      state.doc.transact(() => {
        pinGroup(clusterId);
        setCardCluster(state.board, column, cardId, clusterId);
      });
      track({ name: 'card_group', params: { action: 'join', source: 'menu', surface: 'canvas' } });
    },
    create(column, cardId, label) {
      const state = board.board;
      const card = placedById(cardId);
      const at = worldRectOf(cardId);
      if (!state || !card) return;
      const from = groupOf(cardId);
      // From inside a box, the new one opens beside it, not on top of it.
      const spot = from && at ? freeSpotBeside(groupRect(from), groupBoxSize([card.height]), obstacles()) : at;
      state.doc.transact(() => {
        if (from) pinGroup(from.lane.cluster.id);
        const pos = spot ? { x: spot.x, y: spot.y, z: topZ() } : undefined;
        setCardCluster(state.board, column, cardId, createCluster(state.clusters, label, Date.now(), pos));
      });
      track({ name: 'card_group', params: { action: 'create', source: 'menu', surface: 'canvas' } });
    },
    leave(column, cardId) {
      const state = board.board;
      const card = placedById(cardId);
      const group = groupOf(cardId);
      if (!state || !card || !group) return;
      // Beside the group, in a gap, so it visibly left and covers nothing.
      const spot = freeSpotBeside(groupRect(group), { width: CARD_WIDTH, height: card.height }, obstacles());
      state.doc.transact(() => {
        pinGroup(group.lane.cluster.id);
        setCardPos(state.board, column, cardId, { ...spot, z: topZ() });
        setCardCluster(state.board, column, cardId, null);
      });
      track({ name: 'card_group', params: { action: 'leave', source: 'menu', surface: 'canvas' } });
    },
    rename(clusterId, label) {
      if (board.board) renameCluster(board.board.clusters, clusterId, label);
    },
    dissolve(clusterId) {
      const state = board.board;
      const group = groups.find((g) => g.lane.cluster.id === clusterId);
      if (!state || !group) return;
      // Every card stays exactly where it was drawn inside the box.
      const rects = group.members.map((m) => ({ m, at: worldRectOf(m.card.id) }));
      state.doc.transact(() => {
        let z = topZ();
        for (const { m, at } of rects) if (at) setCardPos(state.board, m.column.key, m.card.id, { x: at.x, y: at.y, z: z++ });
        dissolveCluster(state.doc, state.board, clusterId);
      });
      track({ name: 'card_group', params: { action: 'ungroup', source: 'menu', surface: 'canvas' } });
    },
    merge(clusterId) {
      const state = board.board;
      const group = groups.find((g) => g.lane.cluster.id === clusterId);
      if (!state || !group || group.members.length === 0) return;
      // The merged card is the first member, and takes the box's corner.
      const survivor = group.members[0];
      state.doc.transact(() => {
        setCardPos(state.board, survivor.column.key, survivor.card.id, { x: group.x, y: group.y, z: topZ() });
        mergeCluster(state.doc, state.board, clusterId, prompts.map((c) => c.key));
      });
      track({ name: 'card_group', params: { action: 'merge', source: 'menu', surface: 'canvas' } });
    }
  };

  // What's under the pointer, ignoring the card being dragged and any card whose
  // text is hidden.
  function dropOverAt(client: Point, dragId: string): DropOver {
    for (const el of document.elementsFromPoint(client.x, client.y)) {
      const cardEl = el.closest<HTMLElement>('[data-canvas-card]');
      if (cardEl) {
        const id = cardEl.dataset.canvasCard ?? '';
        if (id === dragId) continue;
        const p = placedById(id);
        if (!p || p.hidden) continue;
        return p.groupId ? { kind: 'group', id: p.groupId } : { kind: 'card', id, clusterId: p.card.clusterId ?? null };
      }
      const groupEl = el.closest<HTMLElement>('[data-canvas-group]');
      if (groupEl?.dataset.canvasGroup) return { kind: 'group', id: groupEl.dataset.canvasGroup };
    }
    return null;
  }

  // The highlight for a drag in progress: what a drop here would join.
  function hoverKey(over: DropOver, dragId: string): string | null {
    if (!over) return null;
    if (over.kind === 'group') return over.id === placedById(dragId)?.groupId ? null : `group:${over.id}`;
    return `card:${over.id}`;
  }

  function dropCard(hit: Placed, at: Point, client: Point) {
    const state = board.board;
    if (!state) return;
    const over = canGroup ? dropOverAt(client, hit.card.id) : null;
    const plan = planCanvasDrop(
      { id: hit.card.id, groupId: hit.groupId, clusterId: hit.card.clusterId ?? null },
      over,
      at,
      canGroup
    );
    const { column } = hit;
    switch (plan.kind) {
      case 'none':
        return;
      case 'place': {
        const others = looseCards.filter((p) => p.card.id !== hit.card.id).map((p) => ({ x: p.x, y: p.y, width: CARD_WIDTH, height: p.height }));
        state.doc.transact(() => {
          if (hit.groupId) pinGroup(hit.groupId);
          if (hit.card.clusterId) setCardCluster(state.board, column.key, hit.card.id, null);
          setCardPos(state.board, column.key, hit.card.id, { ...plan.at, z: topZ() });
        });
        track({ name: 'canvas_drop', params: { on_card: overlapsAny({ ...plan.at, width: CARD_WIDTH, height: hit.height }, others) } });
        if (plan.leaves) track({ name: 'card_group', params: { action: 'leave', source: 'drag', surface: 'canvas' } });
        return;
      }
      case 'join':
        state.doc.transact(() => {
          if (hit.groupId) pinGroup(hit.groupId);
          pinGroup(plan.clusterId);
          setCardCluster(state.board, column.key, hit.card.id, plan.clusterId);
        });
        track({ name: 'card_group', params: { action: 'join', source: 'drag', surface: 'canvas' } });
        return;
      case 'group-with': {
        const target = placedById(plan.targetId);
        if (!target) return;
        state.doc.transact(() => {
          if (hit.groupId) pinGroup(hit.groupId);
          // The box opens where the target card was, on top.
          const pos = { x: target.x, y: target.y, z: topZ() };
          const clusterId = plan.clusterId ?? createCluster(state.clusters, '', Date.now(), pos);
          if (plan.clusterId) setClusterPos(state.clusters, clusterId, pos);
          else setCardCluster(state.board, target.column.key, target.card.id, clusterId);
          setCardCluster(state.board, column.key, hit.card.id, clusterId);
        });
        track({ name: 'card_group', params: { action: 'create', source: 'drag', surface: 'canvas' } });
        return;
      }
    }
  }

  // Hidden in Brainstorm, so a label can't hint at hidden cards.
  const labels = $derived(clustersVisible(board.phase, ended) ? board.labels : []);
  const canAddLabel = $derived(!ended && board.phase !== 'brainstorm' && board.labels.length < MAX_LABELS);
  let editingLabel = $state<string | null>(null);

  // Top voted: from Discuss on. It opens by itself in Discuss, and everywhere
  // else (the Actions dock, an ended board) it's one click away.
  const canShowTopVoted = $derived(ended || board.phase === 'discuss' || board.phase === 'actions');
  const opensTopVoted = $derived(!ended && board.phase === 'discuss');
  let topVotedOpen = $state(false);
  let selectedTopCard = $state<string | null>(null);
  let highlightHandle: ReturnType<typeof setTimeout> | null = null;
  const HIGHLIGHT_MS = 2500;

  $effect(() => {
    topVotedOpen = opensTopVoted;
  });

  // Loose cards and whole groups, ranked together by the people who voted. A
  // hidden card never shows its text or votes here: nothing is hidden by the
  // time voting starts, but a board can be sent back.
  const topVoted = $derived(
    topVotedItems(
      looseCards.filter((p) => !p.hidden).map((p) => ({ id: p.card.id, text: p.card.text, votes: p.card.votes, color: p.column.color })),
      groups.map((g) => ({ id: g.lane.cluster.id, name: clusterDisplayName(g.lane.cluster), cards: g.lane.count, voters: g.lane.voters }))
    )
  );

  function selectTopCard(id: string) {
    const group = groups.find((g) => g.lane.cluster.id === id);
    const hit = placedById(id);
    if (!group && !hit) return;
    // A card in a box is drawn where the box puts it, not at its own position.
    const rect = group ? groupRect(group) : hit?.groupId ? worldRectOf(id) : null;
    moveView(centerOn(view, rect ?? { x: hit!.x, y: hit!.y, width: CARD_WIDTH, height: hit!.height }, viewportSize()));
    selectedTopCard = id;
    if (highlightHandle !== null) clearTimeout(highlightHandle);
    highlightHandle = setTimeout(() => (selectedTopCard = null), HIGHLIGHT_MS);
    track({ name: 'canvas_view', params: { action: 'top_voted' } });
  }
  let labelDraftAt = $state<Point | null>(null);

  // Loose cards and boxes are stacked together, lowest z first.
  const rankOf = $derived.by(() => {
    const order = [
      ...looseCards.map((p) => ({ id: p.card.id, z: p.z })),
      ...groups.map((g) => ({ id: g.lane.cluster.id, z: g.z }))
    ].sort(compareStack);
    return new Map(order.map((c, i) => [c.id, i + 1]));
  });

  function viewportSize() {
    return { width: viewportEl?.clientWidth ?? 0, height: viewportEl?.clientHeight ?? 0 };
  }

  function fit() {
    const rects: Rect[] = [
      ...prompts.map((_, i) => ({
        ...headingPosition(i),
        width: CARD_WIDTH,
        height: HEADING_HEIGHT + MIN_FIT_SLOTS * CARD_SLOT_HEIGHT
      })),
      ...looseCards.map((p) => ({ x: p.x, y: p.y, width: CARD_WIDTH, height: p.height })),
      ...groups.map(groupRect),
      ...labels.map(labelRect)
    ];
    view = fitToBounds(boundsOf(rects), viewportSize());
    followsFit = true;
  }

  // Keeps the whole board showing as the viewport changes size (the dock opening,
  // the composer closing, a window resize), until this person moves the view.
  let followsFit = true;

  // The view after anything but Fit: pan, zoom, or a pan to reveal a card.
  function moveView(next: View) {
    view = next;
    followsFit = false;
  }

  // Everyone's view starts by showing the whole board, once it has loaded.
  let fitted = false;
  $effect(() => {
    if (!board.synced || !viewportEl || fitted) return;
    fitted = true;
    untrack(fit);
  });

  function zoomBy(factor: number) {
    const size = viewportSize();
    moveView(zoomAt(view, { x: size.width / 2, y: size.height / 2 }, view.zoom * factor));
  }

  function pointIn(e: { clientX: number; clientY: number }): Point {
    const rect = viewportEl?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }

  // From the composer: the card takes the next slot under its heading, so pan
  // there if that's off screen.
  function addFromComposer(column: string, text: string) {
    const slot = grid.nextSlot.get(column);
    cardActions.add(column, text);
    if (!slot) return;
    const rect = { ...slot, width: CARD_WIDTH, height: cardSlotHeight(text) };
    const next = panToReveal(view, rect, viewportSize());
    if (next.panX !== view.panX || next.panY !== view.panY) moveView(next);
  }

  // A card being written where someone double-clicked.
  let draftAt = $state<Point | null>(null);

  $effect(() => {
    if (!canAdd && draftAt) cancelDraft();
  });

  $effect(() => {
    if (!canAddLabel && labelDraftAt) labelDraftAt = null;
  });

  function onDoubleClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE) || target.closest('[data-canvas-card], [data-canvas-group], [data-canvas-label]')) return;
    const world = screenToWorld(view, pointIn(e));
    if (canAddLabel) {
      const spot = sanitizePos({ x: world.x, y: world.y - LABEL_GRAB_Y });
      if (spot) labelDraftAt = { x: spot.x, y: spot.y };
      return;
    }
    if (!canAdd) return;
    // Under the pointer, with the card's top edge just above it.
    const clean = sanitizePos({ x: world.x - CARD_WIDTH / 2, y: world.y - 20 });
    if (!clean) return;
    draftAt = { x: clean.x, y: clean.y };
    if (activePrompt) cardActions.setTyping(`new-${activePrompt.key}`);
  }

  function commitDraft(text: string) {
    const at = draftAt;
    draftAt = null;
    cardActions.setTyping(null);
    if (!at || !activePrompt) return;
    cardActions.add(activePrompt.key, text, { ...at, z: nextZ(placed.map((p) => p.card.pos)) });
  }

  function cancelDraft() {
    draftAt = null;
    cardActions.setTyping(null);
  }

  function commitLabelDraft(text: string) {
    const at = labelDraftAt;
    labelDraftAt = null;
    if (at && board.board) createLabel(board.board.labels, text, at);
  }

  function saveLabelEdit(id: string, text: string) {
    editingLabel = null;
    if (board.board) editLabel(board.board.labels, id, text);
  }

  function removeLabel(id: string) {
    editingLabel = null;
    if (board.board) deleteLabel(board.board.labels, id);
  }

  function placedById(cardId: string): Placed | undefined {
    return placed.find((p) => p.card.id === cardId);
  }

  // Live movement, as awareness: not persisted, about 20 times a second.
  let frameHandle: ReturnType<typeof setTimeout> | null = null;
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  let pendingFrame: { id: string; x: number; y: number } | null = null;
  let lastFrameAt = 0;

  function sendDrag(frame: { id: string; x: number; y: number } | null) {
    board.board?.provider.awareness.setLocalStateField('drag', frame);
    lastFrameAt = Date.now();
  }

  function flushFrame() {
    frameHandle = null;
    if (pendingFrame) sendDrag(pendingFrame);
  }

  function queueFrame(frame: { id: string; x: number; y: number }) {
    pendingFrame = frame;
    if (frameHandle !== null) return;
    frameHandle = setTimeout(flushFrame, Math.max(0, DRAG_FRAME_MS - (Date.now() - lastFrameAt)));
  }

  function stopFrames() {
    if (frameHandle !== null) clearTimeout(frameHandle);
    if (heartbeatHandle !== null) clearInterval(heartbeatHandle);
    frameHandle = null;
    heartbeatHandle = null;
    pendingFrame = null;
  }

  // Awareness only reports a change when the state differs, so a peer holding a
  // card still is only visible through its update events.
  $effect(() => {
    const state = board.board;
    if (!state) return;
    const aw = state.provider.awareness;
    const onUpdate = (changes: { added: number[]; updated: number[]; removed: number[] }) => {
      const now = Date.now();
      for (const clientId of [...changes.added, ...changes.updated]) {
        if (clientId === aw.clientID) continue;
        const frame = parseDragFrame((aw.getStates().get(clientId) as { drag?: unknown } | undefined)?.drag);
        if (frame) live.setPeer(clientId, frame, now);
        else live.clearPeer(clientId);
      }
      for (const clientId of changes.removed) live.clearPeer(clientId);
    };
    aw.on('update', onUpdate);
    const sweep = setInterval(() => live.sweep(Date.now()), 250);
    return () => {
      aw.off('update', onUpdate);
      clearInterval(sweep);
    };
  });

  type Gesture =
    | { kind: 'pan'; pointerId: number; last: Point }
    | { kind: 'pinch'; distance: number; mid: Point }
    | {
        kind: 'item';
        pointerId: number;
        id: string;
        // Writes the final position to the doc, once, on drop.
        commit: (at: Point, client: Point) => void;
        // A card in Group: show what a drop here would join.
        groupable: boolean;
        client: Point;
        // A press that never became a drag.
        onClick?: () => void;
        start: Point;
        grab: Point;
        moved: boolean;
        at: Point;
      };

  let gesture: Gesture | null = null;
  const pointers = new Map<number, Point>();

  function pinchMetrics(): { distance: number; mid: Point } | null {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function abortItemDrag() {
    if (gesture?.kind !== 'item') return;
    if (gesture.moved) {
      dropHover = null;
      live.clearOwn();
      stopFrames();
      sendDrag(null);
    }
  }

  function startItem(e: PointerEvent, here: Point, id: string, docPos: Point, commit: (at: Point, client: Point) => void, onClick?: () => void, groupable = false) {
    const pointerWorld = screenToWorld(view, here);
    const from = live.shownAt(id) ?? docPos;
    gesture = {
      kind: 'item',
      pointerId: e.pointerId,
      id,
      commit,
      groupable,
      client: { x: e.clientX, y: e.clientY },
      onClick,
      start: here,
      grab: { x: pointerWorld.x - from.x, y: pointerWorld.y - from.y },
      moved: false,
      at: from
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const here = pointIn(e);
    if (pointers.size === 1 && gesture) {
      // A second finger turns whatever the first was doing into a pinch.
      pointers.set(e.pointerId, here);
      abortItemDrag();
      const metrics = pinchMetrics();
      if (metrics) {
        gesture = { kind: 'pinch', ...metrics };
        gesturing = true;
      }
      return;
    }
    if (target.closest(INTERACTIVE)) return;
    pointers.set(e.pointerId, here);
    const cardEl = target.closest<HTMLElement>('[data-canvas-card]');
    const hit = cardEl ? placedById(cardEl.dataset.canvasCard ?? '') : undefined;
    // A card in a group only comes out of it during Group. Otherwise the press
    // falls through and moves the whole group.
    if (hit && !hit.hidden && !ended && (!hit.groupId || canGroup)) {
      const from = hit.groupId ? (worldRectOf(hit.card.id) ?? hit) : hit;
      startItem(e, here, hit.card.id, { x: from.x, y: from.y }, (at, client) => dropCard(hit, at, client), undefined, canGroup);
      return;
    }
    const groupId = target.closest<HTMLElement>('[data-canvas-group]')?.dataset.canvasGroup;
    const group = groups.find((g) => g.lane.cluster.id === groupId);
    if (group && !ended) {
      startItem(e, here, group.lane.cluster.id, { x: group.x, y: group.y }, (at) => {
        if (!board.board) return;
        setClusterPos(board.board.clusters, group.lane.cluster.id, { ...at, z: topZ() });
        track({ name: 'canvas_group_move', params: { cards: group.members.length } });
      });
      return;
    }
    const labelId = target.closest<HTMLElement>('[data-canvas-label]')?.dataset.canvasLabel;
    const label = labels.find((l) => l.id === labelId);
    if (label && !ended) {
      startItem(
        e,
        here,
        label.id,
        { x: label.x, y: label.y },
        (at) => {
          if (board.board) moveLabel(board.board.labels, label.id, at);
        },
        () => (editingLabel = label.id)
      );
      return;
    }
    gesture = { kind: 'pan', pointerId: e.pointerId, last: here };
    gesturing = true;
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const here = pointIn(e);
    pointers.set(e.pointerId, here);
    if (gesture.kind === 'pan' && gesture.pointerId === e.pointerId) {
      moveView({ ...view, panX: view.panX + here.x - gesture.last.x, panY: view.panY + here.y - gesture.last.y });
      gesture.last = here;
    } else if (gesture.kind === 'pinch') {
      const metrics = pinchMetrics();
      if (!metrics) return;
      const zoomed = zoomAt(view, metrics.mid, (view.zoom * metrics.distance) / gesture.distance);
      moveView({
        ...zoomed,
        panX: zoomed.panX + metrics.mid.x - gesture.mid.x,
        panY: zoomed.panY + metrics.mid.y - gesture.mid.y
      });
      gesture.distance = metrics.distance;
      gesture.mid = metrics.mid;
    } else if (gesture.kind === 'item' && gesture.pointerId === e.pointerId) {
      if (!gesture.moved) {
        if (Math.hypot(here.x - gesture.start.x, here.y - gesture.start.y) < DRAG_THRESHOLD_PX) return;
        gesture.moved = true;
        gesturing = true;
        window.getSelection()?.removeAllRanges();
        const itemId = gesture.id;
        heartbeatHandle = setInterval(() => {
          const at = live.shownAt(itemId);
          if (at && Date.now() - lastFrameAt >= DRAG_HEARTBEAT_MS) sendDrag({ id: itemId, x: at.x, y: at.y });
        }, DRAG_HEARTBEAT_MS);
      }
      const world = screenToWorld(view, here);
      const clean = sanitizePos({ x: world.x - gesture.grab.x, y: world.y - gesture.grab.y });
      if (!clean) return;
      gesture.at = { x: clean.x, y: clean.y };
      gesture.client = { x: e.clientX, y: e.clientY };
      if (gesture.groupable) {
        const key = hoverKey(dropOverAt(gesture.client, gesture.id), gesture.id);
        if (key !== dropHover) dropHover = key;
      }
      live.setOwn(gesture.id, gesture.at);
      queueFrame({ id: gesture.id, x: clean.x, y: clean.y });
    }
  }

  // The real position goes in the doc once, here. The doc write comes before the
  // awareness clear, so peers have the new position when the live one ends.
  function dropItem(g: Extract<Gesture, { kind: 'item' }>) {
    stopFrames();
    dropHover = null;
    g.commit(g.at, g.client);
    live.setDocPos(g.id, g.at);
    live.clearOwn();
    sendDrag(null);
  }

  function onPointerEnd(e: PointerEvent) {
    if (!pointers.delete(e.pointerId) || !gesture) return;
    const g = gesture;
    if (g.kind === 'item' && g.pointerId === e.pointerId) {
      if (g.moved) {
        if (e.type === 'pointercancel') abortItemDrag();
        else dropItem(g);
      } else if (e.type !== 'pointercancel') {
        g.onClick?.();
      }
    } else if (g.kind === 'pinch' && pointers.size === 1) {
      // One finger left: carry on panning with it.
      const [[pointerId, last]] = [...pointers.entries()];
      gesture = { kind: 'pan', pointerId, last };
      return;
    }
    if (pointers.size === 0 || g.kind !== 'pinch') {
      gesture = null;
      gesturing = false;
      pointers.clear();
    }
  }

  let wheelEndHandle: ReturnType<typeof setTimeout> | null = null;

  function onWheel(e: WheelEvent) {
    const target = e.target as HTMLElement;
    const zooming = e.ctrlKey || e.metaKey;
    if (!zooming && target.closest(OWN_SCROLLER)) return;
    e.preventDefault();
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_PX : 1;
    if (zooming) {
      const delta = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, e.deltaY * unit));
      moveView(zoomAt(view, pointIn(e), view.zoom * Math.exp(-delta * WHEEL_ZOOM_SPEED)));
    } else {
      moveView({ ...view, panX: view.panX - e.deltaX * unit, panY: view.panY - e.deltaY * unit });
    }
    gesturing = true;
    if (wheelEndHandle !== null) clearTimeout(wheelEndHandle);
    wheelEndHandle = setTimeout(() => {
      wheelEndHandle = null;
      if (!gesture) gesturing = false;
    }, 150);
  }

  // Tabbing to an off-screen card makes the browser scroll even an overflow-hidden
  // element, which would silently shift everything against the pan. Undo that and
  // pan to the card instead.
  function onViewportScroll() {
    if (!viewportEl) return;
    viewportEl.scrollLeft = 0;
    viewportEl.scrollTop = 0;
  }

  let activeEl: HTMLElement | null = null;

  function setActive(el: HTMLElement | null) {
    if (activeEl === el) return;
    activeEl?.removeAttribute('data-active');
    el?.setAttribute('data-active', '');
    activeEl = el;
  }

  function onFocusIn(e: FocusEvent) {
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>('[data-canvas-card], [data-canvas-label]');
    // Raised so its emoji picker and comments open above the next card.
    setActive(cardEl);
    if (!cardEl || !viewportEl) return;
    onViewportScroll();
    const box = cardEl.getBoundingClientRect();
    const port = viewportEl.getBoundingClientRect();
    const margin = 16;
    let dx = 0;
    let dy = 0;
    if (box.left < port.left) dx = port.left - box.left + margin;
    else if (box.right > port.right) dx = port.right - box.right - margin;
    if (box.top < port.top) dy = port.top - box.top + margin;
    else if (box.bottom > port.bottom && box.height < port.height) dy = port.bottom - box.bottom - margin;
    if (dx || dy) moveView({ ...view, panX: view.panX + dx, panY: view.panY + dy });
  }

  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as HTMLElement | null;
    if (!next || !activeEl?.contains(next)) setActive(null);
  }

  // Shift + arrows on a focused card nudges it, the same shortcut that moves
  // cards on a column board.
  function onKeyDown(e: KeyboardEvent) {
    if (!e.shiftKey || ended || !board.board) return;
    const delta: Record<string, Point> = {
      ArrowUp: { x: 0, y: -NUDGE_WORLD_PX },
      ArrowDown: { x: 0, y: NUDGE_WORLD_PX },
      ArrowLeft: { x: -NUDGE_WORLD_PX, y: 0 },
      ArrowRight: { x: NUDGE_WORLD_PX, y: 0 }
    };
    const step = delta[e.key];
    const target = e.target as HTMLElement;
    if (!step || target.closest('input, textarea')) return;
    const labelId = target.closest<HTMLElement>('[data-canvas-label]')?.dataset.canvasLabel;
    const label = labels.find((l) => l.id === labelId);
    if (label) {
      e.preventDefault();
      moveLabel(board.board.labels, label.id, { x: label.x + step.x, y: label.y + step.y });
      return;
    }
    // Inside a box the arrows move the box: its cards have no place of their own.
    const groupId = target.closest<HTMLElement>('[data-canvas-group]')?.dataset.canvasGroup;
    const group = groups.find((g) => g.lane.cluster.id === groupId);
    if (group) {
      e.preventDefault();
      const clean = sanitizePos({ x: group.x + step.x, y: group.y + step.y, z: topZ() });
      if (clean) setClusterPos(board.board.clusters, group.lane.cluster.id, clean);
      return;
    }
    const hit = placedById(target.closest<HTMLElement>('[data-canvas-card]')?.dataset.canvasCard ?? '');
    if (!hit || hit.hidden) return;
    e.preventDefault();
    const clean = sanitizePos({ x: hit.x + step.x, y: hit.y + step.y, z: topZ() });
    if (clean) setCardPos(board.board.board, hit.column.key, hit.card.id, clean);
  }

  onMount(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    // Stopping the browser's own zoom needs a non-passive listener.
    viewportEl?.addEventListener('wheel', onWheel, { passive: false });
    const resizes = new ResizeObserver(() => {
      if (fitted && followsFit) fit();
    });
    if (viewportEl) resizes.observe(viewportEl);
    return () => {
      resizes.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      viewportEl?.removeEventListener('wheel', onWheel);
    };
  });

  onDestroy(() => {
    abortItemDrag();
    stopFrames();
    if (wheelEndHandle !== null) clearTimeout(wheelEndHandle);
    if (highlightHandle !== null) clearTimeout(highlightHandle);
  });
</script>

<main class="flex-1 min-h-0 w-full flex flex-col">
  <div class="flex-1 min-h-0 flex flex-col md:flex-row">
  <div class="relative flex-1 min-h-0 min-w-0">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={viewportEl}
    class="canvas-viewport absolute inset-0 overflow-hidden touch-none select-none bg-slate-100 dark:bg-slate-950 {gesturing ? 'cursor-grabbing' : 'cursor-grab'}"
    role="region"
    aria-label="Board canvas"
    data-testid="board-canvas"
    onpointerdown={onPointerDown}
    ondblclick={onDoubleClick}
    onscroll={onViewportScroll}
    onfocusin={onFocusIn}
    onfocusout={onFocusOut}
    onkeydown={onKeyDown}
  >
    <div
      class="absolute top-0 left-0 origin-top-left"
      style:transform="translate({view.panX}px, {view.panY}px) scale({view.zoom})"
      style:will-change={gesturing ? 'transform' : undefined}
      data-testid="canvas-world"
    >
      {#each prompts as column, i (column.key)}
        {@const at = headingPosition(i)}
        <div
          class="absolute flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400"
          style:width="{CARD_WIDTH}px"
          style:height="{HEADING_HEIGHT}px"
          style:left="{at.x}px"
          style:top="{at.y}px"
          data-testid="canvas-heading"
        >
          <span class="size-2.5 rounded-full shrink-0 {COLUMN_STYLE[column.color].dot}" aria-hidden="true"></span>
          <EditableHeading
            title={column.title}
            canEdit={isLead && !ended}
            onRename={(t) => onRenameColumn(column.key, t)}
            inputLabel="Prompt name"
            hint="Click to rename this prompt"
            maxLength={MAX_COLUMN_TITLE_LEN}
            headingClass="truncate min-w-0 text-sm font-semibold text-slate-500 dark:text-slate-400"
          />
        </div>
      {/each}
      {#each labels as label (label.id)}
        <CanvasLabel
          {label}
          {live}
          canEdit={!ended}
          editing={editingLabel === label.id}
          onStartEdit={() => (editingLabel = label.id)}
          onEdit={(text) => saveLabelEdit(label.id, text)}
          onCancelEdit={() => (editingLabel = null)}
          onDelete={() => removeLabel(label.id)}
        />
      {/each}
      {#if labelDraftAt}
        <div
          class="absolute"
          style:left="{labelDraftAt.x}px"
          style:top="{labelDraftAt.y}px"
          style:z-index="1000002"
          data-testid="canvas-label-draft"
        >
          <CanvasLabelInput ariaLabel="New label" onCommit={commitLabelDraft} onCancel={() => (labelDraftAt = null)} />
        </div>
      {/if}
      {#each groups as g (g.lane.cluster.id)}
        <CanvasGroup
          lane={g.lane}
          x={g.x}
          y={g.y}
          rank={rankOf.get(g.lane.cluster.id) ?? 0}
          {live}
          canEdit={canGroup}
          canMerge={canGroup && isLead}
          nameHidden={!groupNamesShown}
          mergeInto={mergeTitle(g.lane)}
          highlighted={dropHover === `group:${g.lane.cluster.id}`}
          picked={selectedTopCard === g.lane.cluster.id}
          {clusterActions}
        >
          {#each g.members as p (p.card.id)}
            <CanvasCard
              card={p.card}
              column={p.column}
              x={0}
              y={0}
              rank={0}
              hidden={p.hidden}
              {live}
              {viewer}
              {userName}
              {isLead}
              readOnly={ended}
              {canVote}
              anonymous={board.settings.anonymous}
              {namesMap}
              {cardActions}
              typers={typingByCard.get(p.card.id) ?? []}
              highlighted={selectedTopCard === p.card.id}
              groupId={g.lane.cluster.id}
              groups={groupOptions}
              {canGroup}
              {clusterActions}
              moves={movesFor(p.column.key)}
              onMove={(to) => moveToPrompt(p.column.key, p.card.id, to)}
            />
          {/each}
        </CanvasGroup>
      {/each}
      {#each looseCards as p (p.card.id)}
        <CanvasCard
          card={p.card}
          column={p.column}
          x={p.x}
          y={p.y}
          rank={rankOf.get(p.card.id) ?? 0}
          hidden={p.hidden}
          {live}
          {viewer}
          {userName}
          {isLead}
          readOnly={ended}
          {canVote}
          anonymous={board.settings.anonymous}
          {namesMap}
          {cardActions}
          typers={typingByCard.get(p.card.id) ?? []}
          highlighted={selectedTopCard === p.card.id}
          groups={groupOptions}
          {canGroup}
          isGroupTarget={dropHover === `card:${p.card.id}`}
          {clusterActions}
          moves={movesFor(p.column.key)}
          onMove={(to) => moveToPrompt(p.column.key, p.card.id, to)}
        />
      {/each}
      {#if draftAt && activePrompt}
        <CanvasDraftCard at={draftAt} column={activePrompt} onCommit={commitDraft} onCancel={cancelDraft} />
      {/if}
    </div>
  </div>

  {#if canShowTopVoted && topVotedOpen}
    <TopVotedPanel rows={topVoted} selectedId={selectedTopCard} onSelect={selectTopCard} onClose={() => (topVotedOpen = false)} />
  {/if}

  <div
    class="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 shadow-sm p-1 text-xs"
    role="group"
    aria-label="Canvas view"
  >
    {#if canShowTopVoted && !topVotedOpen}
      <button class="btn-ghost px-2 py-1 min-h-[32px] inline-flex items-center gap-1" onclick={() => (topVotedOpen = true)}>
        <ListOrdered size={14} aria-hidden="true" /> Top voted
      </button>
    {/if}
    <button class="btn-ghost px-2 py-1 min-h-[32px]" onclick={() => zoomBy(1 / BUTTON_ZOOM_STEP)} aria-label="Zoom out">
      <Minus size={14} aria-hidden="true" />
    </button>
    <span class="w-10 text-center tabular-nums text-slate-600 dark:text-slate-300" data-testid="canvas-zoom">{Math.round(view.zoom * 100)}%</span>
    <button class="btn-ghost px-2 py-1 min-h-[32px]" onclick={() => zoomBy(BUTTON_ZOOM_STEP)} aria-label="Zoom in">
      <Plus size={14} aria-hidden="true" />
    </button>
    <button
      class="btn-ghost px-2 py-1 min-h-[32px] inline-flex items-center gap-1"
      onclick={() => {
        fit();
        track({ name: 'canvas_view', params: { action: 'fit' } });
      }}
    >
      <Maximize size={14} aria-hidden="true" /> Fit
    </button>
  </div>
  </div>

  {#if showDock && actionsColumn}
    <CanvasDock
      column={actionsColumn}
      cards={actionCards}
      phase={board.phase}
      {ended}
      {viewer}
      {userName}
      {isLead}
      anonymous={board.settings.anonymous}
      hideCards={board.settings.hideCards}
      {namesMap}
      {typingByCard}
      {reducedMotion}
      {coarsePointer}
      {cardActions}
      onRename={(t) => actionsColumn && onRenameColumn(actionsColumn.key, t)}
    />
  {/if}
  </div>

  {#if canAdd && activePrompt}
    <CanvasComposer
      {prompts}
      activeKey={activePrompt.key}
      typers={typingByCard.get(`new-${activePrompt.key}`) ?? []}
      {coarsePointer}
      onSelect={(key) => (selectedPrompt = key)}
      onAdd={addFromComposer}
      onTyping={cardActions.setTyping}
    />
  {/if}
</main>

<style>
  :global(.canvas-card[data-active]),
  :global(.canvas-card[data-highlighted]) {
    z-index: 1000000 !important;
  }
  /* A card in a box lifts its whole box, so its picker and comments open above
     the next card. */
  :global(.canvas-group:has(.canvas-card[data-active])),
  :global(.canvas-group:has(.canvas-card[data-highlighted])) {
    z-index: 1000000 !important;
  }
  /* Whoever is moving it, a card, box or label in motion is on top. */
  :global(.canvas-group[data-live]),
  :global(.canvas-group:has(.canvas-card[data-live])) {
    z-index: 1000001 !important;
  }
  :global(.canvas-card[data-live]),
  :global(.canvas-label[data-live]) {
    z-index: 1000001 !important;
    cursor: grabbing;
  }
  /* Typing still has to work inside the canvas's select-none. */
  .canvas-viewport :global(input),
  .canvas-viewport :global(textarea) {
    user-select: text;
    -webkit-user-select: text;
  }
</style>
