<script lang="ts">
  import { X } from 'lucide-svelte';
  import CanvasLabelInput from './CanvasLabelInput.svelte';
  import type { LiveMoves } from './canvasLive';
  import type { CanvasLabelData } from './labels';

  // One floating label. Its position is written to the element by LiveMoves, as
  // for a card; the surface handles dragging, finding it through data-canvas-label.
  interface Props {
    label: CanvasLabelData;
    live: LiveMoves;
    canEdit: boolean;
    editing: boolean;
    onStartEdit: () => void;
    onEdit: (text: string) => void;
    onCancelEdit: () => void;
    onDelete: () => void;
  }

  let { label, live, canEdit, editing, onStartEdit, onEdit, onCancelEdit, onDelete }: Props = $props();

  let el = $state<HTMLElement | null>(null);
  const id = $derived(label.id);

  $effect(() => {
    if (!el) return;
    const labelId = id;
    live.register(labelId, el);
    return () => live.unregister(labelId);
  });

  $effect(() => {
    live.setDocPos(id, { x: label.x, y: label.y });
  });

  function onKey(e: KeyboardEvent) {
    if (e.target !== e.currentTarget || !canEdit) return;
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      onStartEdit();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  class="canvas-label group absolute top-0 left-0 flex items-center gap-1 rounded-md px-2 py-1 whitespace-nowrap text-lg font-semibold text-slate-700 dark:text-slate-200 {canEdit ? 'cursor-move hover:bg-white/70 dark:hover:bg-slate-800/70' : ''}"
  style:z-index="0"
  data-canvas-label={id}
  data-testid="canvas-label"
  role={canEdit ? 'group' : undefined}
  aria-label={`Label: ${label.text}`}
  tabindex={canEdit ? 0 : undefined}
  onkeydown={onKey}
>
  {#if editing}
    <CanvasLabelInput value={label.text} ariaLabel="Label text" onCommit={onEdit} onCancel={onCancelEdit} />
  {:else}
    <span>{label.text}</span>
    {#if canEdit}
      <button
        type="button"
        class="rounded p-0.5 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={`Delete label: ${label.text}`}
        onclick={onDelete}
      >
        <X size={14} aria-hidden="true" />
      </button>
    {/if}
  {/if}
</div>
