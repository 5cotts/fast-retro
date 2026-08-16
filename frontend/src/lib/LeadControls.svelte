<script lang="ts">
  import { Timer, Play, Pause, RotateCcw, Download, X, EyeOff, Eye, ArrowDownUp } from 'lucide-svelte';
  import { formatMMSS } from './timer';
  import type { TimerState } from './types';

  let {
    timerInputMin = $bindable(),
    timerState,
    remainingSec,
    timerRunning,
    timerExpired,
    anonymous,
    autoSort,
    onSet,
    onStart,
    onPause,
    onReset,
    onExportCSV,
    onEnd,
    onToggleAnonymous,
    onToggleAutoSort,
    mobile = false
  } = $props<{
    timerInputMin: string;
    timerState: TimerState;
    remainingSec: number;
    timerRunning: boolean;
    timerExpired: boolean;
    anonymous: boolean;
    autoSort: boolean;
    onSet: () => void;
    onStart: () => void;
    onPause: () => void;
    onReset: () => void;
    onExportCSV: () => void;
    onEnd: () => void;
    onToggleAnonymous: () => void;
    onToggleAutoSort: () => void;
    mobile?: boolean;
  }>();

  let popoverOpen = $state(false);
  let popoverEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!popoverOpen) return;
    const close = (e: MouseEvent) => {
      if (popoverEl && e.target instanceof Node && !popoverEl.contains(e.target)) {
        popoverOpen = false;
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') popoverOpen = false;
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onEsc);
    };
  });

  function handleSet() {
    onSet();
  }

  function handleStart() {
    onStart();
  }

  function handlePause() {
    onPause();
  }

  function handleReset() {
    onReset();
  }
</script>

{#if mobile}
  <div class="space-y-2">
    <div class="flex items-center gap-1.5 text-xs flex-wrap">
      <label class="text-xs text-slate-500 dark:text-slate-400 mr-1" for="lead-timer-mobile">Minutes</label>
      <input
        id="lead-timer-mobile"
        bind:value={timerInputMin}
        type="number"
        min="0"
        step="0.5"
        class="input w-16 px-2 py-1.5 min-h-[44px]"
        aria-label="Timer minutes"
      />
      <button class="btn px-3 py-1.5 min-h-[44px]" onclick={handleSet}>Set</button>
      <button
        class="btn px-3 py-1.5 min-h-[44px] border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200"
        onclick={handleStart}
        aria-label="Start timer"
      >
        <Play size={14} aria-hidden="true" />
      </button>
      <button
        class="btn px-3 py-1.5 min-h-[44px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200"
        onclick={handlePause}
        aria-label="Pause timer"
      >
        <Pause size={14} aria-hidden="true" />
      </button>
      <button
        class="btn px-3 py-1.5 min-h-[44px]"
        onclick={handleReset}
        aria-label="Reset timer"
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <button
        class="btn text-sm px-3 py-2 min-h-[44px] {anonymous ? 'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-200 bg-violet-50 dark:bg-violet-900/30' : ''}"
        onclick={onToggleAnonymous}
        aria-pressed={anonymous}
        aria-label={anonymous ? 'Turn off anonymous mode' : 'Turn on anonymous mode'}
        title={anonymous ? 'Anonymous mode is ON — author names are hidden' : 'Anonymous mode is OFF — hide author names on cards and comments'}
      >
        {#if anonymous}
          <EyeOff size={14} aria-hidden="true" /> Anonymous: On
        {:else}
          <Eye size={14} aria-hidden="true" /> Anonymous: Off
        {/if}
      </button>
      <button
        class="btn text-sm px-3 py-2 min-h-[44px] {autoSort
          ? 'border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-200 bg-sky-50 dark:bg-sky-900/30'
          : 'opacity-60'}"
        onclick={onToggleAutoSort}
        aria-pressed={autoSort}
        aria-label={autoSort ? 'Turn off auto-sort by votes' : 'Turn on auto-sort by votes'}
        title={autoSort ? 'Auto-sort is ON — cards reorder by vote count from Discuss onward' : 'Auto-sort is OFF — cards keep their manual order in Discuss and Actions'}
      >
        <ArrowDownUp size={14} aria-hidden="true" />
        {autoSort ? 'Auto-sort: On' : 'Auto-sort: Off'}
      </button>
      <button class="btn text-sm px-3 py-2 min-h-[44px]" onclick={onExportCSV}>
        <Download size={14} aria-hidden="true" /> Download CSV
      </button>
      <button class="btn-danger text-sm px-3 py-2 min-h-[44px]" onclick={onEnd}>
        <X size={14} aria-hidden="true" /> End retro
      </button>
    </div>
  </div>
{:else}
  <div class="relative">
    <button
      class="btn text-xs px-2.5 py-1 min-h-[32px] tabular-nums
        {timerExpired
          ? 'border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-200 motion-safe:animate-pulse'
          : timerRunning
          ? 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200'
          : ''}"
      onclick={() => (popoverOpen = !popoverOpen)}
      aria-expanded={popoverOpen}
      aria-haspopup="dialog"
      title="Timer controls"
    >
      <Timer size={14} aria-hidden="true" />
      <span class="font-medium">{formatMMSS(remainingSec)}</span>
      {#if timerState.paused}
        <span class="text-[10px] opacity-70 ml-0.5">paused</span>
      {/if}
    </button>
    {#if popoverOpen}
      <div
        bind:this={popoverEl}
        class="absolute z-20 top-full right-0 mt-1.5 p-3 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
        role="dialog"
        aria-label="Timer controls"
      >
        <div class="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">Timer</div>
        <div class="flex items-center gap-1.5">
          <label class="text-[11px] text-slate-500 dark:text-slate-400" for="lead-timer-desktop">Min</label>
          <input
            id="lead-timer-desktop"
            bind:value={timerInputMin}
            type="number"
            min="0"
            step="0.5"
            class="input w-16 px-1.5 py-1 text-sm"
            aria-label="Timer minutes"
          />
          <button class="btn text-xs px-2 py-1" onclick={handleSet}>Set</button>
        </div>
        <div class="mt-2 flex items-center gap-1.5">
          <button
            class="btn flex-1 text-xs px-2 py-1.5 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/40"
            onclick={handleStart}
            aria-label="Start timer"
          >
            <Play size={13} aria-hidden="true" /> Start
          </button>
          <button
            class="btn text-xs px-2 py-1.5 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/40"
            onclick={handlePause}
            aria-label="Pause timer"
          >
            <Pause size={13} aria-hidden="true" />
          </button>
          <button
            class="btn text-xs px-2 py-1.5"
            onclick={handleReset}
            aria-label="Reset timer"
          >
            <RotateCcw size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    {/if}
  </div>

  <button
    class="btn text-xs px-2 py-1 min-h-[32px] {anonymous ? 'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-200 bg-violet-50 dark:bg-violet-900/30' : ''}"
    onclick={onToggleAnonymous}
    aria-pressed={anonymous}
    aria-label={anonymous ? 'Turn off anonymous mode' : 'Turn on anonymous mode'}
    title={anonymous ? 'Anonymous mode is ON — author names are hidden on cards and comments' : 'Hide author names on cards and comments'}
  >
    {#if anonymous}
      <EyeOff size={14} aria-hidden="true" />
      <span class="hidden lg:inline">Anonymous</span>
    {:else}
      <Eye size={14} aria-hidden="true" />
      <span class="hidden lg:inline">Anonymous</span>
    {/if}
  </button>

  <button
    class="btn text-xs px-2 py-1 min-h-[32px] {autoSort
      ? 'border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-200 bg-sky-50 dark:bg-sky-900/30'
      : 'opacity-60'}"
    onclick={onToggleAutoSort}
    aria-pressed={autoSort}
    aria-label={autoSort ? 'Turn off auto-sort by votes' : 'Turn on auto-sort by votes'}
    title={autoSort ? 'Auto-sort is ON — cards reorder by vote count from Discuss onward' : 'Auto-sort is OFF — cards keep their manual order in Discuss and Actions'}
  >
    <ArrowDownUp size={14} aria-hidden="true" />
    <span class="hidden lg:inline">{autoSort ? 'Auto-sort: On' : 'Auto-sort: Off'}</span>
  </button>

  <button class="btn text-xs px-2 py-1" onclick={onExportCSV} title="Download as CSV">
    <Download size={14} aria-hidden="true" />
    <span class="hidden lg:inline">Download CSV</span>
  </button>

  <button class="btn-danger text-xs px-2 py-1" onclick={onEnd} title="End retro and clear board">
    End retro
  </button>
{/if}
