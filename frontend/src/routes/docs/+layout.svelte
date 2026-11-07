<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { ArrowLeft, ArrowRight, Menu } from 'lucide-svelte';
  import Wordmark from '$lib/Wordmark.svelte';
  import { track } from '$lib/analytics';
  import { adjacentGuidePages, GUIDE_PAGES, guidePageFor, guidePath } from '$lib/guide/pages';
  import { getTheme } from '$lib/storage';

  let { children } = $props<{ children: Snippet }>();

  const current = $derived(guidePageFor(page.url.pathname));
  const adjacent = $derived(current ? adjacentGuidePages(current.slug) : null);
  let menuOpen = $state(false);

  // Only the board applies the theme otherwise, and the guide is often opened
  // directly or in a new tab.
  onMount(() => {
    const pref = getTheme();
    const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  });

  $effect(() => {
    track({ name: 'guide_view', params: { page: current?.slug ?? 'home' } });
    menuOpen = false;
  });
</script>

<svelte:head>
  <title>{current ? `${current.title} · Fast Retro` : 'User guide · Fast Retro'}</title>
</svelte:head>

{#snippet nav()}
  <ul class="space-y-0.5 text-sm">
    <li>
      <a href="/docs" class="guide-nav-link" aria-current={current ? undefined : 'page'}>Overview</a>
    </li>
    {#each GUIDE_PAGES as p (p.slug)}
      <li>
        <a href={guidePath(p.slug)} class="guide-nav-link" aria-current={current?.slug === p.slug ? 'page' : undefined}>{p.title}</a>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
  <header class="border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 backdrop-blur">
    <div class="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
      <a href="/" class="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md" aria-label="Fast Retro — home">
        <Wordmark />
      </a>
      <a href="/docs" class="text-sm text-slate-500 dark:text-slate-400 hover:underline">User guide</a>
      <a
        href="/"
        class="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md px-2 py-1"
      >
        <ArrowLeft size={13} aria-hidden="true" />
        Back to boards
      </a>
    </div>
  </header>

  <div class="max-w-5xl mx-auto px-4 py-6 md:py-8 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
    <div class="md:hidden mb-5">
      <button
        type="button"
        class="btn text-sm px-3 py-2 min-h-[44px] w-full justify-center"
        aria-expanded={menuOpen}
        aria-controls="guide-menu"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Menu size={15} aria-hidden="true" />
        Guide pages
      </button>
      {#if menuOpen}
        <nav id="guide-menu" class="mt-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2" aria-label="User guide pages">
          {@render nav()}
        </nav>
      {/if}
    </div>

    <nav class="hidden md:block sticky top-6 self-start" aria-label="User guide pages">
      {@render nav()}
    </nav>

    <main class="min-w-0">
      {#if current}
        <article class="guide-prose space-y-8">
          <header>
            <p class="text-xs font-medium text-sky-700 dark:text-sky-300">For: {current.audience.toLowerCase()}</p>
            <h1 class="mt-1 text-2xl font-semibold tracking-tight guide-display">{current.title}</h1>
            <p class="mt-2 text-slate-600 dark:text-slate-300">{current.summary}</p>
          </header>
          {@render children()}
        </article>
        <nav class="mt-10 pt-5 border-t border-slate-200 dark:border-slate-700 flex items-start justify-between gap-4 text-sm" aria-label="Previous and next pages">
          {#if adjacent?.previous}
            <a href={guidePath(adjacent.previous.slug)} class="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 hover:underline" rel="prev">
              <ArrowLeft size={14} aria-hidden="true" class="shrink-0" />
              {adjacent.previous.title}
            </a>
          {:else}
            <a href="/docs" class="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 hover:underline" rel="prev">
              <ArrowLeft size={14} aria-hidden="true" class="shrink-0" />
              Overview
            </a>
          {/if}
          {#if adjacent?.next}
            <a href={guidePath(adjacent.next.slug)} class="ml-auto inline-flex items-center gap-1 text-right text-sky-700 dark:text-sky-300 hover:underline" rel="next">
              {adjacent.next.title}
              <ArrowRight size={14} aria-hidden="true" class="shrink-0" />
            </a>
          {/if}
        </nav>
      {:else}
        {@render children()}
      {/if}
    </main>
  </div>
</div>

<style>
  .guide-nav-link {
    display: block;
    padding: 0.375rem 0.625rem;
    border-radius: 0.375rem;
    color: rgb(71 85 105);
  }
  .guide-nav-link:hover {
    background: rgb(241 245 249);
  }
  .guide-nav-link[aria-current='page'] {
    background: rgb(224 242 254);
    color: rgb(3 105 161);
    font-weight: 500;
  }
  :global(.dark) .guide-nav-link {
    color: rgb(203 213 225);
  }
  :global(.dark) .guide-nav-link:hover {
    background: rgb(30 41 59);
  }
  :global(.dark) .guide-nav-link[aria-current='page'] {
    background: rgb(12 74 110 / 0.5);
    color: rgb(186 230 253);
  }
  .guide-display {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }
  .guide-prose :global(h2) {
    font-weight: 600;
    font-size: 1.125rem;
    line-height: 1.75rem;
    margin-bottom: 0.5rem;
    letter-spacing: -0.011em;
  }
  .guide-prose :global(p),
  .guide-prose :global(li),
  .guide-prose :global(td) {
    line-height: 1.6;
    color: rgb(51 65 85);
  }
  :global(.dark) .guide-prose :global(p),
  :global(.dark) .guide-prose :global(li),
  :global(.dark) .guide-prose :global(td) {
    color: rgb(203 213 225);
  }
  .guide-prose :global(ol) {
    list-style: decimal;
    padding-left: 1.25rem;
  }
  .guide-prose :global(ul) {
    list-style: disc;
    padding-left: 1.25rem;
  }
  .guide-prose :global(ol > li + li),
  .guide-prose :global(ul > li + li) {
    margin-top: 0.5rem;
  }
  .guide-prose :global(code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    background: rgb(241 245 249);
    border: 1px solid rgb(226 232 240);
    border-radius: 4px;
    padding: 0 4px;
  }
  :global(.dark) .guide-prose :global(code) {
    background: rgb(30 41 59);
    border-color: rgb(51 65 85);
  }
  .guide-prose :global(kbd) {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-sans);
    font-size: 0.7rem;
    padding: 1px 5px;
    border: 1px solid rgb(226 232 240);
    border-radius: 4px;
    background: rgb(255 255 255);
    color: rgb(71 85 105);
  }
  :global(.dark) .guide-prose :global(kbd) {
    border-color: rgb(71 85 105);
    background: rgb(30 41 59);
    color: rgb(203 213 225);
  }
  .guide-prose :global(a) {
    color: rgb(3 105 161);
    text-decoration: underline;
  }
  :global(.dark) .guide-prose :global(a) {
    color: rgb(125 211 252);
  }
  .guide-prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .guide-prose :global(th) {
    text-align: left;
    font-weight: 600;
  }
  .guide-prose :global(th),
  .guide-prose :global(td) {
    padding: 0.375rem 0.75rem 0.375rem 0;
    border-bottom: 1px solid rgb(226 232 240);
    vertical-align: top;
  }
  :global(.dark) .guide-prose :global(th),
  :global(.dark) .guide-prose :global(td) {
    border-color: rgb(51 65 85);
  }
</style>
