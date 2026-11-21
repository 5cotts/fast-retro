<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchConfig, fetchVersion } from './api';
  import { track, type AnalyticsEvent } from './analytics';
  import { feedbackHref } from './feedback';

  type From = Extract<AnalyticsEvent, { name: 'feedback_open' }>['params']['from'];

  let { from, class: className = '' } = $props<{ from: From; class?: string }>();

  let href = $state<string | null>(null);

  // Renders nothing unless this deployment sets FEEDBACK_URL, so self-hosted
  // builds show no link.
  onMount(async () => {
    const [cfg, version] = await Promise.all([fetchConfig(), fetchVersion()]);
    if (!cfg.feedbackUrl) return;
    href = feedbackHref(cfg.feedbackUrl, { version: version?.sha, userAgent: navigator.userAgent });
  });
</script>

{#if href}
  <!-- noreferrer matters: on a board the Referer header would carry the board link, which works like a password. -->
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class={className}
    onclick={() => track({ name: 'feedback_open', params: { from } })}
  >
    Send feedback
  </a>
{/if}
