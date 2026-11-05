<script lang="ts">
  import { onMount } from 'svelte';
  import { MAX_LABEL_LEN } from './labels';

  // Writing a label. Enter or clicking away saves, Escape drops the change.
  interface Props {
    value?: string;
    ariaLabel: string;
    onCommit: (text: string) => void;
    onCancel: () => void;
  }

  let { value = '', ariaLabel, onCommit, onCancel }: Props = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(value);
  let el = $state<HTMLInputElement | null>(null);
  let done = false;

  // Finishing removes this element, which fires blur, so only the first counts.
  function finish(save: boolean) {
    if (done) return;
    done = true;
    if (save) onCommit(text);
    else onCancel();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
    // Keys here are for typing, not for the label or the page around it.
    e.stopPropagation();
  }

  onMount(() => {
    el?.focus({ preventScroll: true });
    el?.select();
  });
</script>

<input
  bind:this={el}
  bind:value={text}
  type="text"
  maxlength={MAX_LABEL_LEN}
  placeholder="Label…"
  aria-label={ariaLabel}
  onkeydown={onKey}
  onblur={() => finish(true)}
  class="input w-64 px-2 py-1 text-base font-semibold"
/>
