<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchConfig, fetchVersion } from './api';
  import { track, type AnalyticsEvent } from './analytics';
  import { FEEDBACK_KINDS, feedbackHref, validBoardRef } from './feedback';

  type From = Extract<AnalyticsEvent, { name: 'feedback_open' }>['params']['from'];

  let {
    from,
    boardRef = null,
    separated = false,
    leading = false,
    class: className = ''
  } = $props<{ from: From; boardRef?: string | null; separated?: boolean; leading?: boolean; class?: string }>();

  let base = $state<string | null>(null);
  let version = $state<string | null>(null);

  const ref = $derived(validBoardRef(boardRef));
  const links = $derived(
    base
      ? FEEDBACK_KINDS.map(({ kind, label }) => ({
          kind,
          label,
          href: feedbackHref(base as string, kind, { version, userAgent: navigator.userAgent, boardRef: ref })
        }))
      : []
  );

  // Renders nothing unless this deployment sets FEEDBACK_URL, so self-hosted
  // builds show no link.
  onMount(async () => {
    const [cfg, build] = await Promise.all([fetchConfig(), fetchVersion()]);
    if (!cfg.feedbackUrl) return;
    version = build?.sha ?? null;
    base = cfg.feedbackUrl;
  });
</script>

<!-- noreferrer matters: on a board the Referer header would carry the board link, which works like a password. -->
{#each links as { kind, label, href }, i (kind)}
  {#if separated && (i > 0 || leading)}
    <span aria-hidden="true" class="mx-1">·</span>
  {/if}
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class={className}
    onclick={() => track({ name: 'feedback_open', params: { from, kind } })}
  >
    {label}
  </a>
{/each}
