<script lang="ts">
  import type { PresenceUser } from './types';

  let {
    presence,
    mobile = false
  } = $props<{
    presence: PresenceUser[];
    mobile?: boolean;
  }>();
</script>

{#if mobile}
  <div class="flex items-center gap-1.5 flex-wrap">
    <span class="text-xs text-slate-500 dark:text-slate-400 w-full">{presence.length} online</span>
    {#each presence as p (p.clientId)}
      <span class="pill text-xs px-2 py-1 bg-white dark:bg-slate-700">
        <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}"></span>
        {p.name}{p.isLead ? ' ⭐' : ''}
      </span>
    {/each}
  </div>
{:else}
  <span class="text-xs text-slate-500 dark:text-slate-400 mr-1">{presence.length} online:</span>
  {#each presence as p (p.clientId)}
    <span
      class="pill text-xs px-2 py-0.5"
      title={p.isLead ? `${p.name} (Lead)` : p.name}
    >
      <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}"></span>
      {p.name}{p.isLead ? ' ⭐' : ''}
      {#if p.typing}
        <span class="text-slate-400 dark:text-slate-500 italic ml-0.5">…</span>
      {/if}
    </span>
  {/each}
{/if}
