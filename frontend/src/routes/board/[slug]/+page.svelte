<script lang="ts">
  import { onMount } from 'svelte';
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

  onMount(async () => {
    if (!isValidSlug(slug)) {
      goto('/', { replaceState: true });
      return;
    }
    recordRecentBoard(slug);
    hostKey = getHostKey(slug);
    // Host-ness comes from the server: signed-in creator, or the stored
    // per-board host key. Guests just participate.
    const status = await fetchBoardStatus(slug);
    if (status) {
      isLead = status.amHost;
      ended = status.ended;
    }
    loaded = true;
  });
</script>

{#if isValidSlug(slug) && loaded}
  <Board {isLead} {slug} {hostKey} readOnly={ended} />
{/if}
