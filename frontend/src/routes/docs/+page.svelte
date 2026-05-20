<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Wordmark from '$lib/Wordmark.svelte';
  import { ArrowLeft } from 'lucide-svelte';

  type Role = 'participant' | 'lead';

  let role = $state<Role>('participant');

  // Allow ?role=lead to deep-link straight to the host guide so a fresh
  // facilitator landing here doesn't have to discover the tab.
  onMount(() => {
    const q = page.url.searchParams.get('role');
    if (q === 'lead' || q === 'participant') role = q;
  });

  function setRole(r: Role) {
    role = r;
    const url = new URL(window.location.href);
    url.searchParams.set('role', r);
    history.replaceState({}, '', url.toString());
  }
</script>

<svelte:head>
  <title>Fast Retro — User guide</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
  <header class="border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 backdrop-blur">
    <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
      <a
        href="/"
        class="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md"
        aria-label="Fast Retro — home"
      >
        <Wordmark />
      </a>
      <span class="text-sm text-slate-500 dark:text-slate-400">User guide</span>
      <a
        href="/"
        class="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md px-2 py-1"
      >
        <ArrowLeft size={13} aria-hidden="true" />
        Back to boards
      </a>
    </div>
  </header>

  <main class="max-w-3xl mx-auto px-4 py-8">
    <div
      class="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 mb-8"
      role="tablist"
      aria-label="User role"
    >
      <button
        role="tab"
        aria-selected={role === 'participant'}
        onclick={() => setRole('participant')}
        class="px-4 py-1.5 text-sm rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400
          {role === 'participant'
            ? 'bg-sky-500 text-white shadow-sm'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}"
      >
        For participants
      </button>
      <button
        role="tab"
        aria-selected={role === 'lead'}
        onclick={() => setRole('lead')}
        class="px-4 py-1.5 text-sm rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400
          {role === 'lead'
            ? 'bg-sky-500 text-white shadow-sm'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}"
      >
        For leads
      </button>
    </div>

    {#if role === 'participant'}
      <article class="prose-styled space-y-8" aria-labelledby="participant-heading">
        <section>
          <h1 id="participant-heading" class="text-2xl font-semibold tracking-tight font-display">
            The participant guide
          </h1>
          <p class="mt-2 text-slate-600 dark:text-slate-300">
            You've been invited to a retro. Here's what you actually need to do.
          </p>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Joining the board</h2>
          <p>
            Your lead will share a link like <code class="font-mono text-xs">…/board/&lt;slug&gt;</code>.
            Open it, type a display name, and hit <strong>Join the retro</strong>. Your name is saved
            on this device, so future visits skip the prompt.
          </p>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">The five phases</h2>
          <p class="mb-3">
            The lead walks the team through five phases. The phase strip at the top shows you where
            you are; the actions available to you change with each phase.
          </p>
          <ol class="space-y-3 list-none pl-0">
            <li>
              <strong class="text-sky-700 dark:text-sky-300">1. Brainstorm.</strong>
              Add cards to <em>What went well</em> and <em>What to improve</em>. One thought per card.
              Don't worry about duplication — the Group phase handles that. Card entry is open
              <em>only</em> in this phase.
            </li>
            <li>
              <strong class="text-sky-700 dark:text-sky-300">2. Group.</strong>
              The lead clusters related cards, and may <strong>merge duplicates</strong> by
              dragging one card onto another — the merged card keeps everyone's votes,
              reactions, and comments. You can drag cards too, or use
              <kbd class="kbd-inline">Shift</kbd>+<kbd class="kbd-inline">←/→</kbd> with a card
              focused.
            </li>
            <li>
              <strong class="text-sky-700 dark:text-sky-300">3. Vote.</strong>
              Click the upvote (▲) on the cards you most want to talk about. Voting is only open
              in this phase. There's no per-person limit — the lead is using the totals to prioritize.
            </li>
            <li>
              <strong class="text-sky-700 dark:text-sky-300">4. Discuss.</strong>
              The team works through the top-voted cards. Use 💬 to leave context, and the
              emoji picker (😀) to react with <em>any</em> emoji — agreement, laughter,
              skepticism — without interrupting.
            </li>
            <li>
              <strong class="text-sky-700 dark:text-sky-300">5. Actions.</strong>
              Capture concrete next steps in the <em>Action items</em> column. Be specific — a name
              and a date beat "we should improve testing."
            </li>
          </ol>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Card actions</h2>
          <ul class="space-y-1 list-disc pl-5">
            <li><strong>Vote</strong> (Vote phase) — click ▲ to upvote, click again to undo.</li>
            <li><strong>React</strong> (anytime) — 😀 opens a searchable picker; pick any emoji.</li>
            <li><strong>Comment</strong> (anytime) — 💬 button opens the comment thread.</li>
            <li><strong>Edit / delete your own card</strong> (anytime) — pencil and trash icons appear on cards you authored.</li>
            <li><strong>Move a card</strong> (anytime) — drag, or focus the card and press
              <kbd class="kbd-inline">Shift</kbd>+arrow keys.</li>
          </ul>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Privacy &amp; identity</h2>
          <p>
            Your display name is local to your browser. Authorship is shown on every card and
            comment, so write knowing your name is attached. The footer pencil icon lets you
            change your name at any time.
          </p>
          <p class="mt-3">
            If the lead has turned on <strong>Anonymous mode</strong>, the board header shows
            an "Anonymous" badge and bylines on cards and comments are hidden for everyone.
            Authorship is still recorded — just not displayed — so use it when the team needs
            psychological safety rather than as a guarantee.
          </p>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Are you actually the lead?</h2>
          <p>
            If someone shared the participant URL with you but you're meant to be hosting,
            click <strong>Open as host</strong> in the header. It swaps you onto the
            <code class="font-mono text-xs">/lead/&lt;token&gt;/&lt;slug&gt;</code> URL using
            the token saved in your browser, so you don't have to edit the URL bar by hand.
          </p>
        </section>
      </article>
    {:else}
      <article class="prose-styled space-y-8" aria-labelledby="lead-heading">
        <section>
          <h1 id="lead-heading" class="text-2xl font-semibold tracking-tight font-display">
            The lead guide
          </h1>
          <p class="mt-2 text-slate-600 dark:text-slate-300">
            You're hosting. Your job is to keep the team moving through the phases on time, and
            make sure the action items at the end are real.
          </p>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Setting up the retro</h2>
          <ol class="space-y-3 list-decimal pl-5">
            <li>
              On the homepage, click <strong>Host a retro</strong> and paste the deployment's
              lead token. It's saved to this browser's local storage — you only do this once
              per device.
            </li>
            <li>
              Click <strong>New retro</strong>. You'll land on a fresh board with a generated
              slug and a <strong>Host</strong> badge in the header. Give the board a label
              (pencil icon next to the slug) so it's recognizable in the dashboard later —
              e.g. <em>Sprint 42 — Mobile</em>.
            </li>
            <li>
              Click <strong>Share</strong> in the header to copy the participant URL (the
              <code class="font-mono text-xs">/lead/&lt;token&gt;</code> prefix is stripped
              automatically). Paste it in your team channel.
            </li>
          </ol>
          <p class="mt-3">
            Your host dashboard lives at
            <code class="font-mono text-xs break-all">/lead/&lt;token&gt;</code>. It lists every
            board that's currently live (with participant counts, current phase, and card
            counts) plus a link to your archive of past retros.
          </p>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Running the session</h2>
          <p class="mb-3">
            Suggested cadence for a 45-minute retro of 4–8 people:
          </p>
          <ul class="space-y-2 list-disc pl-5">
            <li><strong>Brainstorm — 10 min.</strong> Start the timer (click the clock pill, set the minutes, hit Start). Everyone silently adds cards.</li>
            <li><strong>Group — 5 min.</strong> Click <em>Next phase</em>. Cluster related cards by dragging. To collapse duplicates, drag one card onto another — they <strong>merge</strong> and the target keeps the combined votes, reactions, and comments.</li>
            <li><strong>Vote — 5 min.</strong> Advance again. Everyone votes; the highest counts surface what to talk about.</li>
            <li><strong>Discuss — 20 min.</strong> Walk through cards in vote order. Use comments to capture insights you want to keep.</li>
            <li><strong>Actions — 5 min.</strong> Capture concrete next steps with owners and dates.</li>
          </ul>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Lead-only controls</h2>
          <ul class="space-y-1 list-disc pl-5">
            <li><strong>Timer.</strong> Click the timer pill in the header — set minutes, Start, Pause, Reset. Engineers see the same countdown.</li>
            <li><strong>Next / Previous phase.</strong> Advance when the room is ready. The <em>← Previous</em> button is there for misclicks — phases don't lose data when you go back.</li>
            <li><strong>Merge cards</strong> (Group phase). Drag one card onto another to collapse duplicates; the combined votes, reactions, and comments carry over.</li>
            <li><strong>Anonymous mode.</strong> Toggle in the header to hide all bylines on cards and comments board-wide. Authorship is still recorded on the server — it's a display switch, not a guarantee — so use it to lower the bar for honest feedback.</li>
            <li><strong>Download CSV.</strong> Snapshot of every card, comment, vote count and reaction. Optional now that <em>End retro</em> auto-archives, but useful if you want a file in your own tools.</li>
            <li><strong>End retro.</strong> Auto-archives the board to <code class="font-mono text-xs break-all">/lead/&lt;token&gt;/archives</code> (cards, votes, reactions, comments, label, timestamp) and then clears it for the next session. Past archives stay browsable from the host dashboard.</li>
          </ul>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Phase gating, in one paragraph</h2>
          <p>
            The phase strip enforces flow: card entry on the input columns is only open in
            Brainstorm; the Action items column only accepts entries in Actions; voting only
            works in the Vote phase. This is what stops late cards from drifting in mid-vote.
            Comments, reactions, edits and drags stay available everywhere — they're for fixing
            mistakes and capturing context, not for primary input.
          </p>
        </section>

        <section>
          <h2 class="font-semibold text-lg mb-2">Recurring retros</h2>
          <p>
            Each slug is its own board. To run the same team every two weeks, give each
            session its own slug (e.g. <code class="font-mono text-xs">sprint-42</code>,
            <code class="font-mono text-xs">sprint-43</code>) and let <em>End retro</em>
            push each one to <code class="font-mono text-xs break-all">/lead/&lt;token&gt;/archives</code>.
            The archive page is the canonical place to find past retros — labels, dates, and
            full card content survive there. The host dashboard at
            <code class="font-mono text-xs break-all">/lead/&lt;token&gt;</code> links to it.
          </p>
        </section>
      </article>
    {/if}
  </main>
</div>

<style>
  .prose-styled :global(h2) {
    letter-spacing: -0.011em;
  }
  .prose-styled :global(p),
  .prose-styled :global(li) {
    line-height: 1.6;
    color: rgb(51 65 85);
  }
  :global(.dark) .prose-styled :global(p),
  :global(.dark) .prose-styled :global(li) {
    color: rgb(203 213 225);
  }
  .prose-styled :global(code) {
    background: rgb(241 245 249);
    border: 1px solid rgb(226 232 240);
    border-radius: 4px;
    padding: 0 4px;
  }
  :global(.dark) .prose-styled :global(code) {
    background: rgb(30 41 59);
    border-color: rgb(51 65 85);
  }
  .font-display {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }
  .kbd-inline {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-sans);
    font-size: 0.7rem;
    padding: 1px 5px;
    border: 1px solid rgb(226 232 240);
    border-radius: 4px;
    background: rgb(255 255 255);
    color: rgb(71 85 105);
  }
  :global(.dark) .kbd-inline {
    border-color: rgb(71 85 105);
    background: rgb(30 41 59);
    color: rgb(203 213 225);
  }
</style>
