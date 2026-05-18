<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Board from '$lib/Board.svelte';
  import { isValidSlug, recordRecentBoard } from '$lib/boards';

  const slug = $derived(page.params.slug ?? '');

  onMount(() => {
    if (!isValidSlug(slug)) {
      goto('/', { replaceState: true });
      return;
    }
    recordRecentBoard(slug);
  });
</script>

{#if isValidSlug(slug)}
  <Board isLead={false} {slug} />
{/if}
