<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Board from '$lib/Board.svelte';
  import { isValidSlug, recordRecentBoard } from '$lib/boards';
  import Wordmark from '$lib/Wordmark.svelte';

  let ok = $state<boolean | null>(null);

  const token = $derived(page.params.token ?? '');
  const slug = $derived(page.params.slug ?? '');

  // Same SvelteKit component-reuse pitfall as /board/[slug]: use an effect
  // keyed on token+slug so this reruns on every in-app navigation between two
  // /lead/... URLs, not just on first mount.
  $effect(() => {
    const currentToken = token;
    const currentSlug = slug;
    if (!currentToken) {
      ok = false;
      return;
    }
    if (!isValidSlug(currentSlug)) {
      goto(`/lead/${currentToken}`, { replaceState: true });
      return;
    }
    ok = null;
    fetch(`/api/lead-token-check/${encodeURIComponent(currentToken)}`)
      .then((r) => r.ok)
      .catch(() => false)
      .then((result) => {
        if (currentToken !== token || currentSlug !== slug) return;
        ok = result;
        if (result) {
          try {
            localStorage.setItem('retro-was-lead', '1');
          } catch {
            // ignore
          }
          recordRecentBoard(currentSlug);
        }
      });
  });
</script>

{#if ok === null}
  <div
    class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-2 text-sm">
      <span class="inline-block w-3 h-3 rounded-full bg-slate-300 dark:bg-slate-600 motion-safe:animate-pulse" aria-hidden="true"></span>
      Checking host link…
    </div>
  </div>
{:else if ok}
  {#key slug}
    <Board isLead={true} {slug} leadToken={token} />
  {/key}
{:else}
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
    <div class="text-center max-w-sm">
      <div class="flex items-center justify-center mb-3">
        <Wordmark size="md" />
      </div>
      <h1 class="text-xl font-semibold tracking-tight mb-2 text-slate-900 dark:text-slate-100">
        This host link isn't valid
      </h1>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">
        The link may have expired, or it doesn't match the current session. Ask your host for a fresh link, or join as a participant.
      </p>
      <a
        href="/"
        class="inline-flex items-center justify-center bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Join the retro
      </a>
    </div>
  </div>
{/if}
