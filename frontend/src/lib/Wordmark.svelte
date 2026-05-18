<script lang="ts">
  let { size = 'md', monogramOnly = false } = $props<{
    size?: 'sm' | 'md' | 'lg';
    monogramOnly?: boolean;
  }>();

  const dim = $derived(size === 'sm' ? 18 : size === 'lg' ? 32 : 22);
  const text = $derived(size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base sm:text-lg');
</script>

<span class="inline-flex items-center gap-2 select-none">
  <span
    class="inline-flex items-center justify-center rounded-md bg-sky-500 text-white shadow-sm"
    style:width="{dim}px"
    style:height="{dim}px"
    aria-hidden={monogramOnly ? undefined : true}
    aria-label={monogramOnly ? 'Fast Retro' : undefined}
  >
    <svg viewBox="0 0 24 24" width={dim - 6} height={dim - 6} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12 L11 18 L19 6" />
    </svg>
  </span>
  {#if !monogramOnly}
    <span class="font-semibold tracking-tight {text} text-slate-900 dark:text-slate-100">
      Fast<span class="text-sky-600 dark:text-sky-400">Retro</span>
    </span>
  {/if}
</span>
