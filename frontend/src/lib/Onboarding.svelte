<script lang="ts">
  import { Pencil, ChevronUp, ArrowLeftRight, X } from 'lucide-svelte';

  let { onDismiss } = $props<{ onDismiss: () => void }>();

  let dialogEl = $state<HTMLDivElement | null>(null);
  let dismissBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    dismissBtn?.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onDismiss();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
  role="dialog"
  aria-modal="true"
  aria-labelledby="onboarding-heading"
  tabindex={-1}
  onclick={onBackdropClick}
>
  <div
    bind:this={dialogEl}
    class="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-6 w-full max-w-md motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
  >
    <button
      class="absolute top-3 right-3 inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 focus:outline-none focus:ring-2 focus:ring-sky-400"
      onclick={onDismiss}
      aria-label="Dismiss tips"
      title="Dismiss"
    >
      <X size={16} aria-hidden="true" />
    </button>

    <h1
      id="onboarding-heading"
      class="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100"
    >
      First retro? A few quick tips.
    </h1>
    <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
      You can dismiss this at any time — it won't come back.
    </p>

    <ul class="mt-5 space-y-4">
      <li class="flex items-start gap-3">
        <span class="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 shrink-0">
          <Pencil size={16} aria-hidden="true" />
        </span>
        <div>
          <div class="text-sm font-medium text-slate-800 dark:text-slate-100">Add cards</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">
            Type in a column's text box and hit <kbd class="px-1 py-0.5 text-[10px] rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 tabular-nums">↵</kbd>
            or <em>Add card</em> (Shift+Enter for a new line). One thought per card.
          </div>
        </div>
      </li>

      <li class="flex items-start gap-3">
        <span class="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-md bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 shrink-0">
          <ChevronUp size={18} aria-hidden="true" />
        </span>
        <div>
          <div class="text-sm font-medium text-slate-800 dark:text-slate-100">Vote on what matters</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">
            Once the retro reaches the Vote phase, click the ▲ on any card to upvote — the top of each column shows what the group most wants to talk about.
          </div>
        </div>
      </li>

      <li class="flex items-start gap-3">
        <span class="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200 shrink-0">
          <ArrowLeftRight size={16} aria-hidden="true" />
        </span>
        <div>
          <div class="text-sm font-medium text-slate-800 dark:text-slate-100">Drag cards between columns</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">
            Drag to reorder or move across columns. Keyboard users can focus a card and press
            <kbd class="px-1 py-0.5 text-[10px] rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 tabular-nums">Shift+↑↓←→</kbd>.
          </div>
        </div>
      </li>
    </ul>

    <button
      bind:this={dismissBtn}
      type="button"
      class="mt-6 w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md py-2.5 font-medium hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-sky-400"
      onclick={onDismiss}
    >
      Got it
    </button>

    <p class="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
      Want more?
      <a href="/docs?role=participant" class="text-sky-600 dark:text-sky-400 hover:underline">
        Read the full guide
      </a>.
    </p>
  </div>
</div>
