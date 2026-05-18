<script lang="ts">
  import { formatMMSS } from './timer';
  import type { PresenceUser, TimerState } from './types';
  import type { ThemePref } from './storage';
  import LeadControls from './LeadControls.svelte';
  import PresenceList from './PresenceList.svelte';
  import NameBadge from './NameBadge.svelte';

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
</script>

<header class="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
  <div class="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-3 flex-wrap">
    <h1 class="text-base sm:text-lg font-semibold">Fast Retro</h1>
    {#if isLead}
      <span
        class="inline-flex items-center text-[10px] sm:text-xs font-semibold uppercase tracking-wide bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-200 border border-fuchsia-200 dark:border-fuchsia-700/50 rounded px-2 py-0.5"
      >
        Lead
      </span>
    {/if}

    <span
      class="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
      title={connected ? 'Connected' : 'Disconnected'}
    >
      <span
        class="inline-block w-2 h-2 rounded-full"
        class:bg-emerald-500={connected}
        class:bg-rose-500={!connected}
      ></span>
      {connected ? 'live' : '…'}
    </span>

    <div
      class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm tabular-nums
        {timerExpired
          ? 'border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 text-rose-700 dark:text-rose-200'
          : timerRunning
          ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200'
          : 'border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}"
      title="Timer"
    >
      <span>⏱</span>
      <span class="font-medium">{formatMMSS(remainingSec)}</span>
      {#if timerState.paused}
        <span class="text-xs opacity-70">(paused)</span>
      {/if}
      {#if timerExpired}
        <span class="text-xs">⏰</span>
      {/if}
    </div>

    <button
      class="sm:hidden ml-auto btn min-w-[44px] min-h-[36px] text-sm px-2 py-1"
      onclick={() => (showMobileMenu = !showMobileMenu)}
      aria-label="Toggle menu"
      aria-expanded={showMobileMenu}
    >
      ☰
    </button>

    <div class="hidden sm:contents">
      {#if isLead}
        <LeadControls
          bind:timerInputMin
          onSet={onSetTimer}
          onStart={onStartTimer}
          onPause={onPauseTimer}
          onReset={onResetTimer}
          {onExportCSV}
          onEnd={onEndBoard}
        />
      {/if}

      <button
        class="btn text-xs px-2 py-1"
        onclick={onCycleTheme}
        title={`Theme: ${themePref}${themePref === 'auto' ? ' (follows system)' : ''} — click to cycle`}
      >
        {themePref === 'auto' ? '🖥' : darkMode ? '☀' : '🌙'}
      </button>

      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <PresenceList {presence} />
        <NameBadge {userName} onChange={onChangeName} />
      </div>
    </div>
  </div>

  {#if showMobileMenu}
    <div class="sm:hidden border-t border-slate-200 dark:border-slate-700 px-3 py-3 space-y-3 bg-slate-50 dark:bg-slate-800/60">
      {#if isLead}
        <LeadControls
          bind:timerInputMin
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
          {themePref === 'auto' ? '🖥' : darkMode ? '☀' : '🌙'} Theme: {themePref}
        </button>
        <NameBadge {userName} onChange={onChangeName} mobile />
      </div>
      <PresenceList {presence} mobile />
    </div>
  {/if}
</header>
