<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    newSlug,
    readRecentBoards,
    recordRecentBoard,
    setPendingLabel,
    type RecentBoard
  } from '$lib/boards';
  import Wordmark from '$lib/Wordmark.svelte';
  import NewRetroModal from '$lib/NewRetroModal.svelte';

  interface LiveBoard {
    slug: string;
    label: string;
    cardCount: number;
    phase: string;
    anonymous: boolean;
    participantCount: number;
  }

  const PHASE_LABEL: Record<string, string> = {
    brainstorm: 'Brainstorm',
    group: 'Group',
    vote: 'Vote',
    discuss: 'Discuss',
    actions: 'Actions'
  };

  let ok = $state<boolean | null>(null);
  let recents = $state<RecentBoard[]>([]);
  let ready = $state(false);
  let showNewModal = $state(false);
  let liveBoards = $state<LiveBoard[]>([]);
  let liveLoaded = $state(false);
  let liveError = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const token = $derived(page.params.token ?? '');

  async function fetchLive() {
    if (!token) return;
    try {
      const r = await fetch('/api/boards', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        liveError = true;
        return;
      }
      liveBoards = (await r.json()) as LiveBoard[];
      liveError = false;
    } catch {
      liveError = true;
    } finally {
      liveLoaded = true;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLive();
    }, 6000);
  }
  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

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
    await fetchLive();
    // Only redirect to a fresh slug for truly first-time hosts: no recents AND
    // no live boards. Otherwise we'd skip past the new dashboard.
    if (recents.length === 0 && liveBoards.length === 0) {
      goto(`/lead/${token}/${newSlug()}`, { replaceState: true });
      return;
    }
    ready = true;
    startPolling();
  });

  onDestroy(stopPolling);

  function openSlug(slug: string) {
    goto(`/lead/${token}/${slug}`);
  }

  function createFresh() {
    showNewModal = true;
  }

  function onNewConfirm({ slug, label }: { slug: string; label: string }) {
    showNewModal = false;
    if (label) {
      recordRecentBoard(slug, { label });
      setPendingLabel(slug, label);
    }
    goto(`/lead/${token}/${slug}`);
  }

  // Live boards are the source of truth for "live"; collapse the recents list
  // to entries that aren't already shown in the Live section so the host
  // doesn't see the same board twice.
  const liveSlugs = $derived(new Set(liveBoards.map((b) => b.slug)));
  const filteredRecents = $derived(recents.filter((r) => !liveSlugs.has(r.slug)));
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
  <div class="min-h-screen bg-slate-50 dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100">
    <div class="w-full max-w-2xl mx-auto">
      <div class="text-center mb-6">
        <div class="flex items-center justify-center mb-2">
          <Wordmark size="lg" />
        </div>
        <div class="text-xs uppercase tracking-wide text-sky-700 dark:text-sky-300 mb-1">Host</div>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
          You're signed in as host. Pick a board to facilitate.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          onclick={createFresh}
          class="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Start a new retro
        </button>
        <a
          href={`/lead/${token}/archives`}
          class="text-center border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-md px-4 py-3 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Past retros
        </a>
      </div>

      <section class="mt-8" aria-labelledby="live-now-heading">
        <div class="flex items-center justify-between mb-2">
          <h2 id="live-now-heading" class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>Live now</span>
            <span
              class="inline-block w-1.5 h-1.5 rounded-full motion-safe:animate-pulse"
              class:bg-emerald-500={liveBoards.length > 0 && !liveError}
              class:bg-slate-300={liveBoards.length === 0 && !liveError}
              class:dark:bg-slate-600={liveBoards.length === 0 && !liveError}
              class:bg-rose-500={liveError}
              aria-hidden="true"
            ></span>
          </h2>
          {#if liveLoaded && !liveError}
            <span class="text-xs text-slate-400 dark:text-slate-500" aria-live="polite">
              {liveBoards.length} active
            </span>
          {/if}
        </div>

        {#if !liveLoaded}
          <div class="text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md p-4">
            Looking for live boards…
          </div>
        {:else if liveError}
          <div class="text-sm text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/30 rounded-md p-3">
            Couldn't reach the server. <button class="underline" onclick={fetchLive}>Retry</button>
          </div>
        {:else if liveBoards.length === 0}
          <div class="text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md p-4 text-center">
            No retros are running right now. Start one with the button above.
          </div>
        {:else}
          <ul class="border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {#each liveBoards as b (b.slug)}
              <li>
                <button
                  class="w-full text-left px-3 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  onclick={() => openSlug(b.slug)}
                >
                  <span class="flex-1 min-w-0">
                    {#if b.label}
                      <span class="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{b.label}</span>
                      <span class="block text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">{b.slug}</span>
                    {:else}
                      <span class="block font-mono text-sm text-slate-700 dark:text-slate-200 truncate">{b.slug}</span>
                      <span class="block text-[11px] text-slate-400 dark:text-slate-500">No label yet</span>
                    {/if}
                  </span>
                  <span class="flex items-center gap-2 shrink-0 text-[11px]">
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50"
                      title="People connected"
                    >
                      <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {b.participantCount}
                    </span>
                    <span
                      class="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900/50"
                      title="Current phase"
                    >
                      {PHASE_LABEL[b.phase] ?? b.phase}
                    </span>
                    <span
                      class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                      title="Cards on the board"
                    >
                      {b.cardCount} {b.cardCount === 1 ? 'card' : 'cards'}
                    </span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if filteredRecents.length > 0}
        <section class="mt-8" aria-labelledby="recent-heading">
          <div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-between">
            <h2 id="recent-heading">Recent boards</h2>
            <a href={`/lead/${token}/history`} class="text-sky-600 dark:text-sky-400 hover:underline normal-case tracking-normal">
              All history →
            </a>
          </div>
          <ul class="border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {#each filteredRecents.slice(0, 8) as r (r.slug)}
              <li>
                <button
                  class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  onclick={() => openSlug(r.slug)}
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
        </section>
      {/if}
    </div>
  </div>

  {#if showNewModal}
    <NewRetroModal
      onClose={() => (showNewModal = false)}
      onConfirm={onNewConfirm}
      hostMode={true}
    />
  {/if}
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
