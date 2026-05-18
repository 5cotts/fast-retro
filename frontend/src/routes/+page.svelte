<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { newSlug, readRecentBoards, type RecentBoard } from '$lib/boards';
  import Wordmark from '$lib/Wordmark.svelte';

  let recents = $state<RecentBoard[]>([]);
  let ready = $state(false);

  onMount(() => {
    const list = readRecentBoards();
    recents = list;
    if (list.length === 0) {
      goto(`/board/${newSlug()}`, { replaceState: true });
      return;
    }
    ready = true;
  });

  function createFresh() {
    goto(`/board/${newSlug()}`);
  }

  function joinRecent(slug: string) {
    goto(`/board/${slug}`);
  }
</script>

{#if ready}
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100">
    <div class="w-full max-w-md">
      <div class="text-center mb-6">
        <div class="flex items-center justify-center mb-2">
          <Wordmark size="lg" />
        </div>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Open a fresh board, or hop back into a recent one.
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
          <h2 class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Recent boards
          </h2>
          <ul class="space-y-1 border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {#each recents.slice(0, 8) as r (r.slug)}
              <li>
                <button
                  class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  onclick={() => joinRecent(r.slug)}
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
{/if}
