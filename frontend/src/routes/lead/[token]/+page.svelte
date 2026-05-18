<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { newSlug, readRecentBoards, type RecentBoard } from '$lib/boards';
  import Wordmark from '$lib/Wordmark.svelte';

  let ok = $state<boolean | null>(null);
  let recents = $state<RecentBoard[]>([]);
  let ready = $state(false);

  const token = $derived(page.params.token ?? '');

  onMount(async () => {
    if (!token) {
      ok = false;
      return;
    }
    try {
      const r = await fetch(`/api/lead-token-check/${encodeURIComponent(token)}`);
      ok = r.ok;
    } catch {
      ok = false;
    }
    if (!ok) return;
    try {
      localStorage.setItem('retro-was-lead', '1');
    } catch {
      // ignore
    }
    recents = readRecentBoards();
    if (recents.length === 0) {
      goto(`/lead/${token}/${newSlug()}`, { replaceState: true });
      return;
    }
    ready = true;
  });

  function openSlug(slug: string) {
    goto(`/lead/${token}/${slug}`);
  }

  function createFresh() {
    goto(`/lead/${token}/${newSlug()}`);
  }
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
{:else if ok && ready}
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100">
    <div class="w-full max-w-md">
      <div class="text-center mb-6">
        <div class="flex items-center justify-center mb-2">
          <Wordmark size="lg" />
        </div>
        <div class="text-xs uppercase tracking-wide text-sky-700 dark:text-sky-300 mb-1">Host</div>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
          You're signed in as host. Pick a board to facilitate.
        </p>
      </div>

      <button
        onclick={createFresh}
        class="w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Start a new retro
      </button>

      {#if recents.length > 0}
        <div class="mt-8">
          <div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-between">
            <span>Recent boards</span>
            <a href={`/lead/${token}/history`} class="text-sky-600 dark:text-sky-400 hover:underline normal-case tracking-normal">
              All history →
            </a>
          </div>
          <ul class="space-y-1 border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {#each recents.slice(0, 8) as r (r.slug)}
              <li>
                <button
                  class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  onclick={() => openSlug(r.slug)}
                >
                  <span class="font-mono text-sm">{r.slug}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(r.lastVisited).toLocaleDateString()}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
{:else if !ok}
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
