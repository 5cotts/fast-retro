<script lang="ts">
  import { Pause, Play } from 'lucide-svelte';
  import { GUIDE_CLIPS, type GuideClipName } from './clips';

  let { name } = $props<{ name: GuideClipName }>();
  const clip = $derived(GUIDE_CLIPS[name as GuideClipName]);

  // Looping motion needs a way to stop it (WCAG 2.2.2), and someone who asked
  // for reduced motion starts stopped. An <img> can't pause, so paused shows the
  // poster, and playing again restarts from the first frame.
  let playing = $state(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
</script>

<figure class="mt-3 relative w-fit max-w-full" data-testid="guide-clip">
  <img
    src={playing ? clip.src : clip.poster}
    alt={clip.alt}
    width={clip.width}
    height={clip.height}
    loading="lazy"
    decoding="async"
    class="block h-auto max-w-full rounded-lg border border-slate-200 dark:border-slate-600"
  />
  <button
    type="button"
    class="absolute top-2 right-2 inline-flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-md border border-slate-300 bg-white/90 text-slate-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-sky-400"
    aria-label={playing ? 'Pause clip' : 'Play clip'}
    title={playing ? 'Pause clip' : 'Play clip'}
    onclick={() => (playing = !playing)}
  >
    {#if playing}
      <Pause size={15} aria-hidden="true" />
    {:else}
      <Play size={15} aria-hidden="true" />
    {/if}
  </button>
</figure>
