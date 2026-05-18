<script lang="ts">
  import { onMount } from 'svelte';
  import { Crown, X, Eye, EyeOff } from 'lucide-svelte';
  import { getLeadToken, setLeadToken, clearLeadToken } from './boards';

  let { onClose, onConfirm } = $props<{
    onClose: () => void;
    onConfirm: (token: string) => void;
  }>();

  let savedToken = $state<string>('');
  let tokenInput = $state<string>('');
  let showToken = $state<boolean>(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);

  onMount(() => {
    savedToken = getLeadToken();
    // Pre-fill the input with the saved value so the user can see what's
    // there, edit it, or just hit Save & host to reuse it.
    tokenInput = savedToken;
    inputEl?.focus();
    inputEl?.select();
  });

  function submit(e?: SubmitEvent) {
    e?.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    setLeadToken(t);
    onConfirm(t);
  }

  function forget() {
    clearLeadToken();
    savedToken = '';
    tokenInput = '';
    inputEl?.focus();
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

  const maskedHint = $derived(
    savedToken.length > 8
      ? `Saved token ends in …${savedToken.slice(-4)}`
      : savedToken
        ? 'Token saved on this device'
        : ''
  );
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
    aria-labelledby="host-modal-heading"
    tabindex="-1"
    class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl w-full max-w-md p-6 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-150"
  >
    <div class="flex items-start gap-3">
      <span
        class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 shrink-0"
        aria-hidden="true"
      >
        <Crown size={18} />
      </span>
      <div class="flex-1 min-w-0">
        <h2 id="host-modal-heading" class="text-lg font-semibold tracking-tight">
          Host a retro
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Paste the host token configured on the server — usually shared by whoever set up the deployment.
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
      <label for="host-token-input" class="text-xs font-medium text-slate-700 dark:text-slate-200">
        Host token
      </label>
      <div class="mt-1 relative">
        <input
          bind:this={inputEl}
          bind:value={tokenInput}
          id="host-token-input"
          type={showToken ? 'text' : 'password'}
          autocomplete="off"
          spellcheck="false"
          placeholder="e.g. 2faed5e5fbc2c73b…"
          class="input w-full pr-10 px-3 py-2.5 min-h-[44px] font-mono text-sm"
        />
        <button
          type="button"
          class="absolute inset-y-0 right-1 my-auto inline-flex items-center justify-center w-8 h-8 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
          onclick={() => (showToken = !showToken)}
          aria-label={showToken ? 'Hide token' : 'Show token'}
        >
          {#if showToken}
            <EyeOff size={14} aria-hidden="true" />
          {:else}
            <Eye size={14} aria-hidden="true" />
          {/if}
        </button>
      </div>

      {#if maskedHint}
        <div class="mt-1.5 flex items-center justify-between gap-2 text-xs">
          <span class="text-slate-500 dark:text-slate-400 truncate">{maskedHint}</span>
          <button
            type="button"
            class="text-rose-600 dark:text-rose-400 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 rounded px-1"
            onclick={forget}
          >
            Forget token
          </button>
        </div>
      {/if}

      <p class="mt-4 text-xs text-slate-500 dark:text-slate-400">
        The token is saved on this device only. Don't paste it into any chat —
        anyone with it can host retros.
      </p>

      <div class="mt-5 flex items-center gap-2">
        <button
          type="submit"
          class="flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md py-2.5 min-h-[44px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          disabled={!tokenInput.trim()}
        >
          Save &amp; host
        </button>
        <button
          type="button"
          class="btn text-sm px-4 py-2 min-h-[44px]"
          onclick={onClose}
        >
          Cancel
        </button>
      </div>
    </form>
  </div>
</div>
