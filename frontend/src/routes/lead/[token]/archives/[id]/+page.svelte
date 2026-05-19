<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Wordmark from '$lib/Wordmark.svelte';
  import { COLUMNS, type CardData, type ColumnKey } from '$lib/types';

  interface Archive {
    id: string;
    slug: string;
    label: string;
    endedAt: number;
    cards: Record<ColumnKey, CardData[]>;
    names: Record<string, string>;
  }

  let ok = $state<boolean | null>(null);
  let archive = $state<Archive | null>(null);
  let loadError = $state<string>('');

  const token = $derived(page.params.token ?? '');
  const id = $derived(page.params.id ?? '');

  onMount(async () => {
    if (!token || !id) {
      ok = false;
      return;
    }
    try {
      const r = await fetch(`/api/archives/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      if (r.status === 403) {
        ok = false;
        return;
      }
      ok = true;
      if (r.ok) {
        archive = (await r.json()) as Archive;
      } else if (r.status === 404) {
        loadError = 'Archive not found.';
      } else {
        loadError = `Couldn't load archive (${r.status})`;
      }
    } catch {
      loadError = 'Network error loading archive';
    }
  });

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

  function authorLabel(authorId: string): string {
    if (!archive) return '';
    return archive.names[authorId] || 'someone';
  }
</script>

<svelte:head>
  <title
    >{archive?.label
      ? `${archive.label} — past retro`
      : archive
        ? `Past retro — ${archive.slug}`
        : 'Past retro'} — Fast Retro</title
  >
</svelte:head>

{#if ok === null}
  <div
    class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
    role="status"
    aria-live="polite"
  >
    <div class="text-sm">Loading archive…</div>
  </div>
{:else if ok}
  <div class="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
    <header class="border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80">
      <div class="max-w-7xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
        <a
          href={`/lead/${token}`}
          class="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md"
          aria-label="Fast Retro — host home"
        >
          <Wordmark />
        </a>
        <span class="text-xs text-slate-500 dark:text-slate-400">· archive</span>
        <a
          href={`/lead/${token}/archives`}
          class="ml-auto text-sm text-sky-600 dark:text-sky-400 hover:underline"
        >
          ← all past retros
        </a>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {#if loadError}
        <div
          class="text-sm border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-100 rounded-md p-3"
        >
          {loadError}
        </div>
      {:else if archive}
        <div class="mb-4">
          <h1 class="text-lg sm:text-xl font-semibold tracking-tight">
            {archive.label || archive.slug}
          </h1>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Ended {formatDate(archive.endedAt)}
            {#if archive.label}
              <span class="font-mono">· {archive.slug}</span>
            {/if}
            · read-only snapshot
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          {#each COLUMNS as col (col.key)}
            {@const cards = archive.cards[col.key] ?? []}
            <section class="border rounded-xl shadow-sm flex flex-col {col.accent}" aria-label={col.title}>
              <header
                class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-baseline justify-between rounded-t-xl {col.header}"
              >
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-5 rounded-full {col.dot}" aria-hidden="true"></span>
                  <h2 class="text-sm font-semibold">{col.title}</h2>
                </div>
                <span class="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{cards.length}</span>
              </header>
              <ul class="p-3 space-y-2">
                {#each cards as card (card.id)}
                  <li
                    class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm shadow-sm"
                    data-testid="archive-card"
                  >
                    <div class="whitespace-pre-wrap break-words">{card.text}</div>
                    <div class="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>by {authorLabel(card.authorId)}</span>
                      {#if card.votes.length > 0}
                        <span class="tabular-nums">👍 {card.votes.length}</span>
                      {/if}
                      {#each Object.entries(card.reactions) as [emoji, users] (emoji)}
                        {#if users.length > 0}
                          <span class="tabular-nums">{emoji} {users.length}</span>
                        {/if}
                      {/each}
                      {#if card.comments.length > 0}
                        <span>💬 {card.comments.length}</span>
                      {/if}
                    </div>
                    {#if card.comments.length > 0}
                      <ul class="mt-2 space-y-1 border-t border-slate-100 dark:border-slate-700 pt-2">
                        {#each card.comments as c (c.id)}
                          <li class="text-xs text-slate-600 dark:text-slate-300">
                            <span class="font-medium text-slate-700 dark:text-slate-200">
                              {authorLabel(c.authorId)}:
                            </span>
                            {c.text}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </li>
                {:else}
                  <li class="text-xs text-slate-500 dark:text-slate-400 italic px-1 py-3">
                    No cards in this column.
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
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
