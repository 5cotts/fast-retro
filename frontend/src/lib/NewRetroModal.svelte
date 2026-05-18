<script lang="ts">
  import { onMount } from 'svelte';
  import { Sparkles, X } from 'lucide-svelte';
  import { newSlug, slugifyLabel } from './boards';

  let { onClose, onConfirm, hostMode = false } = $props<{
    onClose: () => void;
    onConfirm: (result: { slug: string; label: string }) => void;
    hostMode?: boolean;
  }>();

  let labelInput = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);

  onMount(() => {
    inputEl?.focus();
  });

  // Preview the slug derived from the typed name so the user understands the URL
  // they're about to land on. If the field is empty, fall back to a random slug
  // hint without burning a real one — we only mint the real slug on submit.
  const previewSlug = $derived(slugifyLabel(labelInput) || '— random —');

  function submit(e?: SubmitEvent) {
    e?.preventDefault();
    const label = labelInput.trim().slice(0, 60);
    const base = slugifyLabel(label);
    const slug = base ? `${base}-${newSlug(3)}` : newSlug();
    onConfirm({ slug, label });
  }

  function skip() {
    onConfirm({ slug: newSlug(), label: '' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
  onclick={onBackdrop}
>
  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-retro-heading"
    tabindex="-1"
    class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl w-full max-w-md p-6 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-150"
  >
    <div class="flex items-start gap-3">
      <span
        class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 shrink-0"
        aria-hidden="true"
      >
        <Sparkles size={18} />
      </span>
      <div class="flex-1 min-w-0">
        <h2 id="new-retro-heading" class="text-lg font-semibold tracking-tight">
          Start a new retro
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Give it a name so you {hostMode ? 'and your team' : ''}can find it later. Optional — leave blank for a quick anonymous board.
        </p>
      </div>
      <button
        type="button"
        class="btn-ghost text-slate-500 dark:text-slate-400 -mr-2 -mt-1 min-h-[32px] min-w-[32px] px-1.5"
        onclick={onClose}
        aria-label="Close"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>

    <form class="mt-5" onsubmit={submit}>
      <label for="new-retro-name" class="text-xs font-medium text-slate-700 dark:text-slate-200">
        Retro name
      </label>
      <input
        bind:this={inputEl}
        bind:value={labelInput}
        id="new-retro-name"
        type="text"
        maxlength="60"
        autocomplete="off"
        placeholder="e.g. Sprint 42 — Mobile"
        class="mt-1 input w-full px-3 py-2.5 min-h-[44px] text-sm"
      />

      <div class="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>URL slug:</span>
        <code class="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 truncate max-w-[16rem]">
          /board/{previewSlug}
        </code>
      </div>

      <div class="mt-5 flex items-center gap-2">
        <button
          type="submit"
          class="flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md py-2.5 min-h-[44px] font-medium hover:opacity-90 transition-opacity"
        >
          Create retro
        </button>
        <button
          type="button"
          class="btn text-sm px-4 py-2 min-h-[44px]"
          onclick={skip}
        >
          Skip naming
        </button>
      </div>
    </form>
  </div>
</div>
