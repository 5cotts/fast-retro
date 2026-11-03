<script lang="ts">
  import { Timer, Play, Pause, RotateCcw, X, EyeOff, Eye, ArrowDownUp, Blinds, Settings2 } from 'lucide-svelte';
  import ExportMenu from './ExportMenu.svelte';
  import { formatMMSS } from './timer';
  import type { TimerState } from './types';
  import type { BoardSettingKey, BoardSettings } from './settings';

  // One entry per board setting the host can toggle; both layouts render
  // from this list.
  const TOGGLES: {
    key: BoardSettingKey;
    icon: (on: boolean) => typeof Eye;
    ariaLabel: (on: boolean) => string;
    title: (on: boolean) => string;
    text: (on: boolean) => string;
    compactText: (on: boolean) => string;
    onClass: string;
    offClass: string;
  }[] = [
    {
      key: 'anonymous',
      icon: (on) => (on ? EyeOff : Eye),
      ariaLabel: (on) => (on ? 'Turn off anonymous mode' : 'Turn on anonymous mode'),
      title: (on) => (on ? 'Anonymous mode is ON — author names are hidden on cards and comments' : 'Hide author names on cards and comments'),
      text: (on) => (on ? 'Anonymous: On' : 'Anonymous: Off'),
      compactText: () => 'Anonymous',
      onClass: 'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-200 bg-violet-50 dark:bg-violet-900/30',
      offClass: ''
    },
    {
      key: 'autoSort',
      icon: () => ArrowDownUp,
      ariaLabel: (on) => (on ? 'Turn off auto-sort by votes' : 'Turn on auto-sort by votes'),
      title: (on) =>
        on
          ? 'Auto-sort is ON — cards reorder by vote count from Discuss onward'
          : 'Auto-sort is OFF — cards keep their manual order in Discuss and Actions',
      text: (on) => (on ? 'Auto-sort: On' : 'Auto-sort: Off'),
      compactText: (on) => (on ? 'Auto-sort: On' : 'Auto-sort: Off'),
      onClass: 'border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-200 bg-sky-50 dark:bg-sky-900/30',
      offClass: 'opacity-60'
    },
    {
      key: 'hideCards',
      icon: () => Blinds,
      ariaLabel: (on) => (on ? "Stop hiding others' cards" : "Hide others' cards while brainstorming"),
      title: (on) =>
        (on
          ? "Others' cards are hidden until the Group phase."
          : "Hide others' cards until the Group phase.") +
        " Stops people from being influenced by others' ideas. It isn't a security feature.",
      text: (on) => (on ? 'Hide cards: On' : 'Hide cards: Off'),
      compactText: () => 'Hide cards',
      onClass: 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30',
      offClass: ''
    }
  ];

  let {
    timerInputMin = $bindable(),
    timerState,
    remainingSec,
    timerRunning,
    timerExpired,
    settings,
    onSet,
    onStart,
    onPause,
    onReset,
    onExportCSV,
    onExportJSON,
    onEnd,
    onToggleSetting,
    onEditBoard,
    mobile = false
  } = $props<{
    timerInputMin: string;
    timerState: TimerState;
    remainingSec: number;
    timerRunning: boolean;
    timerExpired: boolean;
    settings: BoardSettings;
    onSet: () => void;
    onStart: () => void;
    onPause: () => void;
    onReset: () => void;
    onExportCSV: () => void;
    onExportJSON: () => void;
    onEnd: () => void;
    onToggleSetting: (key: BoardSettingKey) => void;
    onEditBoard: () => void;
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
      <button class="btn text-sm px-3 py-2 min-h-[44px]" onclick={onEditBoard}>
        <Settings2 size={14} aria-hidden="true" /> Edit board
      </button>
      {#each TOGGLES as t (t.key)}
        {@const on = settings[t.key]}
        {@const Icon = t.icon(on)}
        <button
          class="btn text-sm px-3 py-2 min-h-[44px] {on ? t.onClass : t.offClass}"
          onclick={() => onToggleSetting(t.key)}
          aria-pressed={on}
          aria-label={t.ariaLabel(on)}
          title={t.title(on)}
        >
          <Icon size={14} aria-hidden="true" /> {t.text(on)}
        </button>
      {/each}
      <ExportMenu onSaveBoardFile={onExportJSON} {onExportCSV} />
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
    class="btn text-xs px-2 py-1 min-h-[32px]"
    onclick={onEditBoard}
    aria-label="Edit board"
    title="Edit board: name, columns and options"
  >
    <Settings2 size={14} aria-hidden="true" />
    <span class="hidden lg:inline">Edit</span>
  </button>

  {#each TOGGLES as t (t.key)}
    {@const on = settings[t.key]}
    {@const Icon = t.icon(on)}
    <button
      class="btn text-xs px-2 py-1 min-h-[32px] {on ? t.onClass : t.offClass}"
      onclick={() => onToggleSetting(t.key)}
      aria-pressed={on}
      aria-label={t.ariaLabel(on)}
      title={t.title(on)}
    >
      <Icon size={14} aria-hidden="true" />
      <span class="hidden lg:inline">{t.compactText(on)}</span>
    </button>
  {/each}

  <ExportMenu onSaveBoardFile={onExportJSON} {onExportCSV} compact />

  <button class="btn-danger text-xs px-2 py-1" onclick={onEnd} title="End retro and clear board">
    End retro
  </button>
{/if}
