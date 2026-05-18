<script lang="ts">
  import type { ThemePref } from './storage';

  let {
    nameInput = $bindable(''),
    themePref,
    darkMode,
    onCommit,
    onCycleTheme
  } = $props<{
    nameInput: string;
    themePref: ThemePref;
    darkMode: boolean;
    onCommit: () => void;
    onCycleTheme: () => void;
  }>();

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!nameInput.trim()) return;
    onCommit();
  }

  let inputEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    inputEl?.focus();
  });
</script>

<div
  class="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900"
  role="dialog"
  aria-modal="true"
  aria-labelledby="welcome-heading"
>
  <form
    class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-6 w-full max-w-sm"
    onsubmit={submit}
  >
    <h1 id="welcome-heading" class="text-2xl font-semibold tracking-tight mb-1 text-slate-900 dark:text-slate-100">
      Welcome to the retro
    </h1>
    <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">What should we call you?</p>
    <input
      bind:this={inputEl}
      bind:value={nameInput}
      type="text"
      maxlength="40"
      placeholder="Your name"
      aria-label="Your display name"
      class="input w-full px-3 py-2.5 min-h-[44px]"
    />
    <button
      type="submit"
      class="mt-4 w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md py-2.5 font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      disabled={!nameInput.trim()}
    >
      Join the retro
    </button>
    <button
      type="button"
      class="mt-3 w-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      onclick={onCycleTheme}
      title="Cycle theme: auto → light → dark"
    >
      Theme: {themePref}{themePref === 'auto' ? ` (${darkMode ? 'dark' : 'light'})` : ''}
    </button>
  </form>
</div>
