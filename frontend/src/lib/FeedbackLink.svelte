<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchConfig, fetchVersion } from './api';
  import { track, type AnalyticsEvent } from './analytics';
  import { feedbackHref, validBoardRef } from './feedback';

  type From = Extract<AnalyticsEvent, { name: 'feedback_open' }>['params']['from'];

  let {
    from,
    boardRef = null,
    class: className = ''
  } = $props<{ from: From; boardRef?: string | null; class?: string }>();

  let base = $state<string | null>(null);
  let version = $state<string | null>(null);
  let copied = $state(false);

  const ref = $derived(validBoardRef(boardRef));
  const href = $derived(
    base ? feedbackHref(base, { version, userAgent: navigator.userAgent, boardRef: ref }) : null
  );

  async function copyRef() {
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // The reference is printed on the button, so it can still be typed in.
    }
  }

  // Renders nothing unless this deployment sets FEEDBACK_URL, so self-hosted
  // builds show no link.
  onMount(async () => {
    const [cfg, build] = await Promise.all([fetchConfig(), fetchVersion()]);
    if (!cfg.feedbackUrl) return;
    version = build?.sha ?? null;
    base = cfg.feedbackUrl;
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
  {#if ref}
    <button
      type="button"
      class={className}
      title="Paste this reference into your report. It lets the maintainer find your board without the board link."
      onclick={copyRef}
    >
      {copied ? 'Copied' : `Board ref ${ref}`}
    </button>
  {/if}
{/if}
