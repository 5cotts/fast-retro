<script lang="ts">
  import type { PresenceUser } from './types';
  import { Crown } from 'lucide-svelte';

  let {
    presence,
    currentClientId,
    mobile = false
  } = $props<{
    presence: PresenceUser[];
    currentClientId: number;
    mobile?: boolean;
  }>();

  // Hide self from the presence list — `NameBadge` already shows the user
  // their own name. This removes the long-standing "Alice (you)" duplication.
  const others = $derived(presence.filter((p: PresenceUser) => p.clientId !== currentClientId));
  const othersLabel = $derived(
    others.length === 0 ? 'No one else online' : `${others.length} other${others.length === 1 ? '' : 's'} online`
  );
</script>

{#if mobile}
  <div class="flex items-center gap-1.5 flex-wrap">
    <span class="text-xs text-slate-500 dark:text-slate-400 w-full">{othersLabel}</span>
    {#each others as p (p.clientId)}
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs px-2 py-1 text-slate-700 dark:text-slate-200"
        title={p.isLead ? `${p.name} (host)` : p.name}
      >
        <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}" aria-hidden="true"></span>
        <span class="truncate max-w-[140px]">{p.name}</span>
        {#if p.isLead}
          <Crown size={11} class="text-amber-500" aria-label="host" />
        {/if}
      </span>
    {/each}
  </div>
{:else}
  <div
    class="hidden md:flex items-center gap-1.5 flex-wrap"
    aria-label={othersLabel}
  >
    {#if others.length === 0}
      <span class="text-xs text-slate-400 dark:text-slate-500 italic">Just you</span>
    {:else}
      {#each others as p (p.clientId)}
        <span
          class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-xs px-2 py-0.5 text-slate-700 dark:text-slate-200 transition-colors"
          title={p.isLead ? `${p.name} (host)` : p.name}
        >
          <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}" aria-hidden="true"></span>
          <span class="truncate max-w-[110px]">{p.name}</span>
          {#if p.isLead}
            <Crown size={11} class="text-amber-500" aria-label="host" />
          {/if}
          {#if p.typing}
            <span class="text-slate-400 dark:text-slate-500" aria-label="typing">…</span>
          {/if}
        </span>
      {/each}
    {/if}
  </div>
{/if}
