<script lang="ts">
  import type { PresenceUser } from './types';
  import { Crown, Presentation } from 'lucide-svelte';

  let {
    presence,
    currentClientId,
    mobile = false
  } = $props<{
    presence: PresenceUser[];
    currentClientId: number;
    mobile?: boolean;
  }>();

  const self = $derived(
    presence.find((p: PresenceUser) => p.clientId === currentClientId) ?? null
  );
  const others = $derived(presence.filter((p: PresenceUser) => p.clientId !== currentClientId));
  // e.g. "Scott (you, host, presenting)". The screen icon means that client
  // is presenting (viewer.ts), so its screen shows nobody's input as theirs.
  function titleFor(p: PresenceUser, you: boolean): string {
    const tags = [you && 'you', p.isLead && 'host', p.presenting && 'presenting'].filter(Boolean);
    return tags.length ? `${p.name} (${tags.join(', ')})` : p.name;
  }

  const ariaLabel = $derived(
    others.length === 0 ? 'You are the only one online' : `${others.length} other${others.length === 1 ? '' : 's'} online`
  );
</script>

{#if mobile}
  <div class="flex items-center gap-1.5 flex-wrap">
    <span class="text-xs text-slate-500 dark:text-slate-400 w-full">{ariaLabel}</span>
    {#if self}
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-white/60 dark:bg-slate-700/60 text-xs px-2 py-1 text-slate-600 dark:text-slate-300 opacity-80"
        title={titleFor(self, true)}
      >
        <span class="inline-block w-2 h-2 rounded-full" style="background:{self.color}" aria-hidden="true"></span>
        <span class="truncate max-w-[120px]">{self.name}</span>
        <span class="text-slate-500 dark:text-slate-400">(you)</span>
        {#if self.isLead}
          <Crown size={11} class="text-amber-500" aria-label="host" />
        {/if}
        {#if self.presenting}
          <Presentation size={11} class="text-slate-500 dark:text-slate-400" aria-label="presenting" />
        {/if}
      </span>
    {/if}
    {#each others as p (p.clientId)}
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs px-2 py-1 text-slate-700 dark:text-slate-200"
        title={titleFor(p, false)}
      >
        <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}" aria-hidden="true"></span>
        <span class="truncate max-w-[140px]">{p.name}</span>
        {#if p.isLead}
          <Crown size={11} class="text-amber-500" aria-label="host" />
        {/if}
        {#if p.presenting}
          <Presentation size={11} class="text-slate-500 dark:text-slate-400" aria-label="presenting" />
        {/if}
      </span>
    {/each}
  </div>
{:else}
  <div class="hidden md:flex items-center gap-1.5 flex-wrap" aria-label={ariaLabel}>
    {#if self}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-slate-200/80 dark:border-slate-700/60 bg-white/40 dark:bg-slate-800/40 text-xs px-2 py-0.5 text-slate-500 dark:text-slate-400"
        title={titleFor(self, true)}
      >
        <span class="inline-block w-2 h-2 rounded-full" style="background:{self.color}" aria-hidden="true"></span>
        <span class="truncate max-w-[110px]">{self.name}</span>
        <span class="text-slate-500 dark:text-slate-400">(you)</span>
        {#if self.isLead}
          <Crown size={11} class="text-amber-500" aria-label="host" />
        {/if}
        {#if self.presenting}
          <Presentation size={11} class="text-slate-500 dark:text-slate-400" aria-label="presenting" />
        {/if}
      </span>
    {/if}
    {#each others as p (p.clientId)}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-xs px-2 py-0.5 text-slate-700 dark:text-slate-200 transition-colors"
        title={titleFor(p, false)}
      >
        <span class="inline-block w-2 h-2 rounded-full" style="background:{p.color}" aria-hidden="true"></span>
        <span class="truncate max-w-[110px]">{p.name}</span>
        {#if p.isLead}
          <Crown size={11} class="text-amber-500" aria-label="host" />
        {/if}
        {#if p.presenting}
          <Presentation size={11} class="text-slate-500 dark:text-slate-400" aria-label="presenting" />
        {/if}
        {#if p.typing}
          <span class="text-slate-500 dark:text-slate-400" aria-label="typing">…</span>
        {/if}
      </span>
    {/each}
  </div>
{/if}
