<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { readRecentBoards, forgetRecentBoard, type RecentBoard } from '$lib/boards';

  let ok = $state<boolean | null>(null);
  let recents = $state<RecentBoard[]>([]);

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
    if (ok) recents = readRecentBoards();
  });

  function removeEntry(slug: string) {
    forgetRecentBoard(slug);
    recents = readRecentBoards();
  }

  function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }
</script>

{#if ok === null}
  <div
    class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
    role="status"
    aria-live="polite"
  >
    <div class="text-sm">Checking host link…</div>
  </div>
{:else if ok}
  <div class="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
    <header class="border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80">
      <div class="max-w-3xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
        <h1 class="text-base sm:text-lg font-semibold tracking-tight">Fast Retro · history</h1>
        <span class="text-xs text-slate-500 dark:text-slate-400">host</span>
        <a href={`/lead/${token}`} class="ml-auto text-sm text-sky-600 dark:text-sky-400 hover:underline">
          ← back to host
        </a>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-3 sm:px-4 py-6">
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Boards you've opened from this browser. This is a local list — past board content lives on the server
        as long as the service is up, but card snapshots aren't persisted to disk.
      </p>

      {#if recents.length === 0}
        <div class="text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md p-6 text-center">
          No past boards yet. Open a board and it will show up here.
        </div>
      {:else}
        <ul class="border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
          {#each recents as r (r.slug)}
            <li class="flex items-center gap-3 px-3 py-2.5">
              <a
                href={`/board/${r.slug}`}
                class="flex-1 min-w-0 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
              >
                <div class="font-mono text-sm truncate">{r.slug}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400">{relativeTime(r.lastVisited)}</div>
              </a>
              <a
                href={`/lead/${token}/${r.slug}`}
                class="text-xs px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title="Open as host"
              >
                Host
              </a>
              <button
                onclick={() => removeEntry(r.slug)}
                class="text-xs px-2 py-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"
                aria-label={`Forget board ${r.slug}`}
              >
                Forget
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </main>
  </div>
{:else}
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
    <div class="text-center max-w-sm">
      <h1 class="text-xl font-semibold tracking-tight mb-2 text-slate-900 dark:text-slate-100">
        This host link isn't valid
      </h1>
      <a
        href="/"
        class="inline-flex items-center justify-center bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Join the retro
      </a>
    </div>
  </div>
{/if}
