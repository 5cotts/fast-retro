<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Wordmark from '$lib/Wordmark.svelte';

  interface ArchiveSummary {
    id: string;
    slug: string;
    label: string;
    endedAt: number;
    cardCount: number;
    topVoted: string | null;
  }

  let ok = $state<boolean | null>(null);
  let items = $state<ArchiveSummary[]>([]);
  let loadError = $state<string>('');
  let deleting = $state<Set<string>>(new Set());

  const token = $derived(page.params.token ?? '');

  async function loadArchives() {
    try {
      const r = await fetch('/api/archives', {
        headers: { authorization: `Bearer ${token}` }
      });
      if (r.ok) {
        items = (await r.json()) as ArchiveSummary[];
      } else {
        loadError = `Couldn't load archives (${r.status})`;
      }
    } catch {
      loadError = 'Network error loading archives';
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
    if (ok) await loadArchives();
  });

  async function removeArchive(id: string) {
    if (!confirm('Delete this archived retro? This cannot be undone.')) return;
    const next = new Set(deleting);
    next.add(id);
    deleting = next;
    try {
      const r = await fetch(`/api/archives/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` }
      });
      if (r.ok) {
        items = items.filter((a) => a.id !== id);
      }
    } finally {
      const after = new Set(deleting);
      after.delete(id);
      deleting = after;
    }
  }

  function formatDate(ms: number): string {
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
</script>

<svelte:head>
  <title>Past retros — Fast Retro</title>
</svelte:head>

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
        <a
          href={`/lead/${token}`}
          class="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md"
          aria-label="Fast Retro — host home"
        >
          <Wordmark />
        </a>
        <span class="text-xs text-slate-500 dark:text-slate-400">· past retros</span>
        <a
          href={`/lead/${token}`}
          class="ml-auto text-sm text-sky-600 dark:text-sky-400 hover:underline"
        >
          ← back to host
        </a>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-3 sm:px-4 py-6">
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Archived snapshots from "End retro." These are server-stored — anyone with the host token can open
        them.
      </p>

      {#if loadError}
        <div
          class="mb-4 text-sm border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-100 rounded-md p-3"
        >
          {loadError}
        </div>
      {/if}

      {#if items.length === 0 && !loadError}
        <div
          class="text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md p-6 text-center"
        >
          No archived retros yet. End a retro and a snapshot will show up here.
        </div>
      {:else}
        <ul
          class="border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
        >
          {#each items as a (a.id)}
            <li class="flex items-start gap-3 px-3 py-3" data-testid="archive-item">
              <a
                href={`/lead/${token}/archives/${a.id}`}
                class="flex-1 min-w-0 hover:underline focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
              >
                <div class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                  {a.label || a.slug}
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {formatDate(a.endedAt)} · {a.cardCount} card{a.cardCount === 1 ? '' : 's'}
                  {#if a.label}
                    <span class="text-slate-400 dark:text-slate-500 font-mono">· {a.slug}</span>
                  {/if}
                </div>
                {#if a.topVoted}
                  <div class="text-xs text-slate-600 dark:text-slate-300 mt-1 italic truncate">
                    Top voted: "{a.topVoted}"
                  </div>
                {/if}
              </a>
              <button
                onclick={() => removeArchive(a.id)}
                disabled={deleting.has(a.id)}
                class="text-xs px-2 py-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors disabled:opacity-50"
                aria-label={`Delete archive from ${formatDate(a.endedAt)}`}
              >
                {deleting.has(a.id) ? '…' : 'Delete'}
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
      <div class="flex items-center justify-center mb-3">
        <Wordmark size="md" />
      </div>
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
