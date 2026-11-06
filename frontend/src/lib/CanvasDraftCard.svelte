<script lang="ts">
  import { onMount } from 'svelte';
  import { CARD_WIDTH, type Point } from './canvas';
  import { COLUMN_PLACEHOLDER, COLUMN_STYLE, type ColumnDef } from './columns';

  // A card being written where someone double-clicked. Enter or clicking away
  // saves it, Escape or leaving it empty drops it.
  interface Props {
    at: Point;
    column: ColumnDef;
    onCommit: (text: string) => void;
    onCancel: () => void;
  }

  let { at, column, onCommit, onCancel }: Props = $props();

  let text = $state('');
  let el = $state<HTMLTextAreaElement | null>(null);
  let done = false;

  // Saving removes this element, which fires blur, so only the first one counts.
  function finish(save: boolean) {
    if (done) return;
    done = true;
    const t = text.trim();
    if (save && t) onCommit(t);
    else onCancel();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  }

  onMount(() => el?.focus({ preventScroll: true }));
</script>

<div
  class="absolute rounded-xl border p-1 shadow-lg {COLUMN_STYLE[column.color].accent}"
  style:width="{CARD_WIDTH}px"
  style:left="{at.x}px"
  style:top="{at.y}px"
  style:z-index="1000002"
  data-column={column.key}
  data-testid="canvas-draft"
>
  <textarea
    bind:this={el}
    bind:value={text}
    onkeydown={onKey}
    onblur={() => finish(true)}
    placeholder={COLUMN_PLACEHOLDER}
    rows="3"
    aria-label={`New card in ${column.title}`}
    class="input w-full resize-none px-2.5 py-2 text-sm leading-snug"
  ></textarea>
</div>
