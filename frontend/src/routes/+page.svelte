<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    newSlug,
    readRecentBoards,
    getLeadToken,
    recordRecentBoard,
    setPendingLabel,
    type RecentBoard
  } from '$lib/boards';
  import Wordmark from '$lib/Wordmark.svelte';
  import HostModal from '$lib/HostModal.svelte';
  import NewRetroModal from '$lib/NewRetroModal.svelte';
  import { Crown } from 'lucide-svelte';

  let recents = $state<RecentBoard[]>([]);
  let ready = $state(false);
  let showHostModal = $state(false);
  let showNewModal = $state(false);
  let pendingHostToken = $state<string>('');
  let savedToken = $state<string>('');

  onMount(() => {
    const list = readRecentBoards();
    recents = list;
    savedToken = getLeadToken();
    if (list.length === 0) {
      goto(`/board/${newSlug()}`, { replaceState: true });
      return;
    }
    ready = true;
  });

  function createFresh() {
    pendingHostToken = '';
    showNewModal = true;
  }

  function joinRecent(slug: string) {
    goto(`/board/${slug}`);
  }

  function openHost() {
    const token = getLeadToken();
    if (token) {
      pendingHostToken = token;
      showNewModal = true;
      return;
    }
    showHostModal = true;
  }

  function onHostConfirm(token: string) {
    showHostModal = false;
    pendingHostToken = token;
    showNewModal = true;
  }

  function onNewConfirm({ slug, label }: { slug: string; label: string }) {
    showNewModal = false;
    // Stash the label locally so the board page can hydrate Yjs with it on first
    // mount, and recents shows the name immediately even before the CRDT syncs.
    if (label) {
      recordRecentBoard(slug, { label });
      // Forward to the board: if we land as host, apply this label to Yjs on
      // first mount so participants see the name too.
      if (pendingHostToken) setPendingLabel(slug, label);
    }
    if (pendingHostToken) {
      goto(`/lead/${pendingHostToken}/${slug}`);
    } else {
      goto(`/board/${slug}`);
    }
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
        class="w-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-3 min-h-[44px] text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Start a new retro
      </button>

      <button
        onclick={openHost}
        class="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-200 px-4 py-3 min-h-[44px] text-sm font-medium hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
      >
        <Crown size={14} aria-hidden="true" />
        {savedToken ? 'Host a new retro' : 'Host a retro…'}
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
                  <span class="flex-1 min-w-0 flex flex-col">
                    {#if r.label}
                      <span class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{r.label}</span>
                      <span class="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">{r.slug}</span>
                    {:else}
                      <span class="font-mono text-sm text-slate-700 dark:text-slate-200 truncate">{r.slug}</span>
                    {/if}
                  </span>
                  <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    {new Date(r.lastVisited).toLocaleDateString()}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <p class="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
        New here?
        <a href="/docs" class="text-sky-600 dark:text-sky-400 hover:underline">Read the user guide</a>.
      </p>
    </div>
  </div>
{/if}

{#if showHostModal}
  <HostModal onClose={() => (showHostModal = false)} onConfirm={onHostConfirm} />
{/if}

{#if showNewModal}
  <NewRetroModal
    onClose={() => (showNewModal = false)}
    onConfirm={onNewConfirm}
    hostMode={!!pendingHostToken}
  />
{/if}
