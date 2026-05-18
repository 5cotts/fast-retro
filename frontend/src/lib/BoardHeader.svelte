<script lang="ts">
  import { formatMMSS } from './timer';
  import type { PresenceUser, TimerState } from './types';
  import type { ThemePref } from './storage';
  import LeadControls from './LeadControls.svelte';
  import PresenceList from './PresenceList.svelte';
  import NameBadge from './NameBadge.svelte';
  import { Menu, Monitor, Sun, Moon } from 'lucide-svelte';

  let {
    isLead,
    connected,
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
    onSetTimer,
    onStartTimer,
    onPauseTimer,
    onResetTimer,
    onExportCSV,
    onEndBoard,
    onCycleTheme,
    onChangeName
  } = $props<{
    isLead: boolean;
    connected: boolean;
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
    onSetTimer: () => void;
    onStartTimer: () => void;
    onPauseTimer: () => void;
    onResetTimer: () => void;
    onExportCSV: () => void;
    onEndBoard: () => void;
    onCycleTheme: () => void;
    onChangeName: (newName: string) => void;
  }>();

  let showMobileMenu = $state(false);

  const timerVisible = $derived(
    timerState.durationSec > 0 || timerState.startedAt !== null || timerState.paused
  );
</script>

<header class="border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-slate-900/60">
  <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3 flex-wrap">
    <div class="flex items-center gap-2">
      <h1 class="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Fast Retro
      </h1>
      {#if isLead}
        <span
          class="inline-flex items-center text-[10px] sm:text-xs font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-200/80 dark:border-sky-700/50 rounded px-1.5 py-0.5"
        >
          Host
        </span>
      {/if}
    </div>

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
        {#if isLead}
          <LeadControls
            bind:timerInputMin
            {timerState}
            {remainingSec}
            {timerRunning}
            {timerExpired}
            onSet={onSetTimer}
            onStart={onStartTimer}
            onPause={onPauseTimer}
            onReset={onResetTimer}
            {onExportCSV}
            onEnd={onEndBoard}
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
          onSet={onSetTimer}
          onStart={onStartTimer}
          onPause={onPauseTimer}
          onReset={onResetTimer}
          {onExportCSV}
          onEnd={onEndBoard}
          mobile
        />
      {/if}
      <div class="flex items-center gap-2 flex-wrap">
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
