<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Board from '$lib/Board.svelte';

  let ok = $state<boolean | null>(null);

  onMount(async () => {
    const token = page.params.token;
    if (!token) {
      ok = false;
      return;
    }
    try {
      const r = await fetch(`/api/lead-token-check/${encodeURIComponent(token)}`);
      ok = r.ok;
    } catch {
      ok = false;
    }
  });
</script>

{#if ok === null}
  <div class="min-h-screen flex items-center justify-center text-slate-500">Checking lead token…</div>
{:else if ok}
  <Board isLead={true} />
{:else}
  <div class="min-h-screen flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-xl font-semibold mb-2">Invalid lead token</h1>
      <p class="text-sm text-slate-500 mb-4">This link isn't valid for the current session.</p>
      <a href="/" class="text-sky-600 underline">Join as engineer</a>
    </div>
  </div>
{/if}
