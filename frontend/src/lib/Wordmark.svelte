<script lang="ts">
  let { size = 'md', monogramOnly = false } = $props<{
    size?: 'sm' | 'md' | 'lg';
    monogramOnly?: boolean;
  }>();

  const dim = $derived(size === 'sm' ? 18 : size === 'lg' ? 32 : 22);
  const text = $derived(size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base sm:text-lg');
  const glyph = $derived(dim - 6);
</script>

<span class="inline-flex items-center gap-2 select-none">
  <span
    class="inline-flex items-center justify-center rounded-md bg-sky-500 text-white shadow-sm"
    style:width="{dim}px"
    style:height="{dim}px"
    aria-hidden={monogramOnly ? undefined : true}
    aria-label={monogramOnly ? 'Fast Retro' : undefined}
  >
    <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <!-- Counter-clockwise arrow: the "retro" rewind. -->
      <path d="M3 12 a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 8 7 8" />
      <!-- Clock hands at center: 10 past 10, leaning forward for "fast". -->
      <path d="M12 8 V12 L15 13.5" />
    </svg>
  </span>
  {#if !monogramOnly}
    <span class="font-display font-semibold tracking-tight {text} text-slate-900 dark:text-slate-100">
      Fast<span class="text-sky-600 dark:text-sky-400">Retro</span>
    </span>
  {/if}
</span>

<style>
  .font-display {
    font-family: var(--font-display);
    /* Space Grotesk has a slightly looser default — pull it tight to match Inter rhythm. */
    letter-spacing: -0.02em;
  }
</style>
