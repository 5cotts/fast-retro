<script lang="ts">
  import { formatMMSS } from './timer';
  import type { PresenceUser, TimerState } from './types';
  import type { ThemePref } from './storage';
  import LeadControls from './LeadControls.svelte';
  import PresenceList from './PresenceList.svelte';
  import NameBadge from './NameBadge.svelte';
  import Wordmark from './Wordmark.svelte';
  import BoardLabel from './BoardLabel.svelte';
  import { Menu, Monitor, Sun, Moon, Link2, Check, EyeOff } from 'lucide-svelte';

  let {
    isLead,
    connected,
    label,
    slug,
    timerState,
    remainingSec,
    timerRunning,
    timerExpired,
    timerInputMin = $bindable(),
    themePref,
    darkMode,
    presence,
    currentClientId,
    userName,
    anonymous,
    onSetTimer,
    onStartTimer,
    onPauseTimer,
    onResetTimer,
    onExportCSV,
    onEndBoard,
    onCycleTheme,
    onChangeName,
    onChangeLabel,
    onToggleAnonymous
  } = $props<{
    isLead: boolean;
    connected: boolean;
    label: string;
    slug: string;
    timerState: TimerState;
    remainingSec: number;
    timerRunning: boolean;
    timerExpired: boolean;
    timerInputMin: string;
    themePref: ThemePref;
    darkMode: boolean;
    presence: PresenceUser[];
    currentClientId: number;
    userName: string;
    anonymous: boolean;
    onSetTimer: () => void;
    onStartTimer: () => void;
    onPauseTimer: () => void;
    onResetTimer: () => void;
    onExportCSV: () => void;
    onEndBoard: () => void;
    onCycleTheme: () => void;
    onChangeName: (newName: string) => void;
    onChangeLabel: (next: string) => void;
    onToggleAnonymous: () => void;
  }>();

  let showMobileMenu = $state(false);
  let linkCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const timerVisible = $derived(
    timerState.durationSec > 0 || timerState.startedAt !== null || timerState.paused
  );

  async function copyBoardLink() {
    if (typeof window === 'undefined') return;
    // Always share the participant URL (no /lead/<token>/ prefix), even from a lead view.
    const url = new URL(window.location.href);
    const slugMatch = url.pathname.match(/\/board\/([^/]+)|\/lead\/[^/]+\/([^/]+)/);
    const slug = slugMatch ? slugMatch[1] || slugMatch[2] : '';
    const shareUrl = slug ? `${url.origin}/board/${slug}` : `${url.origin}${url.pathname}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Fallback for older browsers / insecure contexts.
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // give up silently — most modern browsers won't hit this path
      }
      document.body.removeChild(ta);
    }
    linkCopied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      linkCopied = false;
      copyTimer = null;
    }, 1600);
  }
</script>

<header class="border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-slate-900/60">
  <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3 flex-wrap">
    <a href="/" class="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-400 rounded-md" aria-label="Fast Retro — home">
      <Wordmark />
      {#if isLead}
        <span
          class="inline-flex items-center text-[10px] sm:text-xs font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-200/80 dark:border-sky-700/50 rounded px-1.5 py-0.5"
        >
          Host
        </span>
      {/if}
    </a>

    <BoardLabel {label} {slug} canEdit={isLead} onSave={onChangeLabel} />

    <span
      class="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
      title={connected ? 'Connected to the board' : 'Reconnecting…'}
      aria-live="polite"
    >
      <span
        class="inline-block w-2 h-2 rounded-full transition-colors"
        class:bg-emerald-500={connected}
        class:bg-amber-500={!connected}
      ></span>
      <span class="hidden sm:inline">{connected ? 'Live' : 'Connecting…'}</span>
    </span>

    {#if anonymous}
      <span
        class="inline-flex items-center gap-1 text-[10px] sm:text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200 border border-violet-200/80 dark:border-violet-700/50 rounded px-1.5 py-0.5"
        title="Anonymous mode is on — author names are hidden on cards and comments."
        aria-label="Anonymous mode on"
      >
        <EyeOff size={11} aria-hidden="true" />
        Anonymous
      </span>
    {/if}

    {#if !isLead && timerVisible}
      <div
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm tabular-nums
          {timerExpired
            ? 'border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 text-rose-700 dark:text-rose-200 motion-safe:animate-pulse'
            : timerRunning
            ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200'
            : 'border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}"
        title="Timer"
        role="timer"
        aria-live="off"
      >
        <span aria-hidden="true">⏱</span>
        <span class="font-medium">{formatMMSS(remainingSec)}</span>
        {#if timerState.paused}
          <span class="text-xs opacity-70">paused</span>
        {/if}
      </div>
    {/if}

    <button
      class="sm:hidden ml-auto btn min-w-[44px] min-h-[40px] text-sm px-2 py-1"
      onclick={() => (showMobileMenu = !showMobileMenu)}
      aria-label="Toggle menu"
      aria-expanded={showMobileMenu}
    >
      <Menu size={18} aria-hidden="true" />
    </button>

    <div class="hidden sm:contents">
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <button
          class="btn text-xs px-2 py-1 min-h-[32px]"
          onclick={copyBoardLink}
          aria-label={linkCopied ? 'Board link copied to clipboard' : 'Copy board link to share with teammates'}
          title={linkCopied ? 'Link copied' : 'Copy board link'}
        >
          {#if linkCopied}
            <Check size={14} aria-hidden="true" />
            <span aria-hidden="true">Copied</span>
          {:else}
            <Link2 size={14} aria-hidden="true" />
            <span aria-hidden="true">Share</span>
          {/if}
        </button>

        {#if isLead}
          <LeadControls
            bind:timerInputMin
            {timerState}
            {remainingSec}
            {timerRunning}
            {timerExpired}
            {anonymous}
            onSet={onSetTimer}
            onStart={onStartTimer}
            onPause={onPauseTimer}
            onReset={onResetTimer}
            {onExportCSV}
            onEnd={onEndBoard}
            {onToggleAnonymous}
          />
        {/if}

        <button
          class="btn text-xs px-2 py-1 min-h-[32px]"
          onclick={onCycleTheme}
          aria-label={`Theme: ${themePref}${themePref === 'auto' ? ' (follows system)' : ''} — click to cycle`}
          title={`Theme: ${themePref}${themePref === 'auto' ? ' (follows system)' : ''} — click to cycle`}
        >
          {#if themePref === 'auto'}
            <Monitor size={14} aria-hidden="true" />
          {:else if darkMode}
            <Sun size={14} aria-hidden="true" />
          {:else}
            <Moon size={14} aria-hidden="true" />
          {/if}
        </button>

        <PresenceList {presence} {currentClientId} />
        <NameBadge {userName} onChange={onChangeName} />
      </div>
    </div>
  </div>

  {#if showMobileMenu}
    <div
      class="sm:hidden border-t border-slate-200 dark:border-slate-700 px-3 py-3 space-y-3 bg-slate-50 dark:bg-slate-800/60 motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-150"
    >
      {#if isLead}
        <LeadControls
          bind:timerInputMin
          {timerState}
          {remainingSec}
          {timerRunning}
          {timerExpired}
          {anonymous}
          onSet={onSetTimer}
          onStart={onStartTimer}
          onPause={onPauseTimer}
          onReset={onResetTimer}
          {onExportCSV}
          onEnd={onEndBoard}
          {onToggleAnonymous}
          mobile
        />
      {/if}
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="btn text-sm px-3 py-2 min-h-[44px]"
          onclick={copyBoardLink}
          aria-label={linkCopied ? 'Board link copied to clipboard' : 'Copy board link to share with teammates'}
        >
          {#if linkCopied}
            <Check size={14} aria-hidden="true" />
            Copied
          {:else}
            <Link2 size={14} aria-hidden="true" />
            Share link
          {/if}
        </button>
        <button class="btn text-sm px-3 py-2 min-h-[44px]" onclick={onCycleTheme}>
          {#if themePref === 'auto'}
            <Monitor size={14} aria-hidden="true" />
          {:else if darkMode}
            <Sun size={14} aria-hidden="true" />
          {:else}
            <Moon size={14} aria-hidden="true" />
          {/if}
          Theme: {themePref}
        </button>
        <NameBadge {userName} onChange={onChangeName} mobile />
      </div>
      <PresenceList {presence} {currentClientId} mobile />
    </div>
  {/if}
</header>
