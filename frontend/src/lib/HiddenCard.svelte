<script lang="ts">
  import { Blinds } from 'lucide-svelte';
  // Stands in for someone else's card while cards are hidden. It renders no
  // card text at all (not blurred text), so nothing can be read or copied
  // from the page.
</script>

<div
  role="group"
  aria-label="Hidden card"
  data-testid="hidden-card"
  class="bg-white/70 dark:bg-slate-800/60 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg px-3.5 py-3 text-sm select-none"
>
  <div class="space-y-1.5" aria-hidden="true">
    <div class="h-2.5 w-4/5 rounded bg-slate-200 dark:bg-slate-700"></div>
    <div class="h-2.5 w-3/5 rounded bg-slate-200 dark:bg-slate-700"></div>
  </div>
  <div class="mt-2 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
    <Blinds size={12} aria-hidden="true" /> Hidden until Group
  </div>
</div>
