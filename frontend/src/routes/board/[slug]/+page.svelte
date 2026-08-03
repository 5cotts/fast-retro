<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Board from '$lib/Board.svelte';
  import { isValidSlug, recordRecentBoard, getHostKey } from '$lib/boards';
  import { fetchBoardStatus } from '$lib/api';

  const slug = $derived(page.params.slug ?? '');

  let loaded = $state(false);
  let isLead = $state(false);
  let ended = $state(false);
  let hostKey = $state('');

  // SvelteKit reuses this page's component instance across /board/[slug]
  // navigations that only change the param (e.g. "Start next retro" going
  // straight from one board to another) — onMount would only fire once and
  // leave stale host/ended state. Use an effect keyed on `slug` so this reruns
  // on every navigation, and guard the async response against a slug change
  // that happened while the fetch was in flight.
  $effect(() => {
    const currentSlug = slug;
    if (!isValidSlug(currentSlug)) {
      goto('/', { replaceState: true });
      return;
    }
    loaded = false;
    recordRecentBoard(currentSlug);
    hostKey = getHostKey(currentSlug);
    fetchBoardStatus(currentSlug).then((status) => {
      if (currentSlug !== slug) return; // navigated again before this resolved
      if (status) {
        isLead = status.amHost;
        ended = status.ended;
      }
      loaded = true;
    });
  });
</script>

{#if isValidSlug(slug) && loaded}
  {#key slug}
    <Board {isLead} {slug} {hostKey} readOnly={ended} />
  {/key}
{/if}
