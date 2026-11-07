<script lang="ts">
  import { GUIDE_PAGES, guidePath } from '$lib/guide/pages';
</script>

<h1 class="text-2xl font-semibold tracking-tight" style="font-family: var(--font-display); letter-spacing: -0.02em">User guide</h1>
<p class="mt-2 text-slate-600 dark:text-slate-300">What are you trying to do?</p>

<ul class="mt-6 grid gap-3 sm:grid-cols-2">
  {#each GUIDE_PAGES as p (p.slug)}
    <li>
      <a
        href={guidePath(p.slug)}
        class="block h-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 hover:border-sky-400 dark:hover:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 transition-colors"
      >
        <span class="block font-medium text-slate-900 dark:text-slate-100">{p.title}</span>
        <span class="mt-1 block text-sm text-slate-600 dark:text-slate-300">{p.summary}</span>
        <span class="mt-2 block text-xs text-slate-500 dark:text-slate-400">For: {p.audience.toLowerCase()}</span>
      </a>
    </li>
  {/each}
</ul>
