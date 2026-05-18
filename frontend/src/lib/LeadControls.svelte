<script lang="ts">
  let {
    timerInputMin = $bindable(),
    onSet,
    onStart,
    onPause,
    onReset,
    onExportCSV,
    onEnd,
    mobile = false
  } = $props<{
    timerInputMin: string;
    onSet: () => void;
    onStart: () => void;
    onPause: () => void;
    onReset: () => void;
    onExportCSV: () => void;
    onEnd: () => void;
    mobile?: boolean;
  }>();
</script>

{#if mobile}
  <div class="flex items-center gap-1.5 text-xs flex-wrap">
    <input
      bind:value={timerInputMin}
      type="number"
      min="0"
      step="0.5"
      class="input w-16 px-2 py-1.5 min-h-[36px]"
      title="Minutes"
    />
    <button class="btn px-3 py-1.5 min-h-[36px]" onclick={onSet}>Set</button>
    <button
      class="btn px-3 py-1.5 min-h-[36px] border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200"
      onclick={onStart}
    >
      ▶
    </button>
    <button
      class="btn px-3 py-1.5 min-h-[36px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200"
      onclick={onPause}
    >
      ⏸
    </button>
    <button class="btn px-3 py-1.5 min-h-[36px]" onclick={onReset}>⟲</button>
  </div>
  <div class="flex items-center gap-2 flex-wrap">
    <button class="btn text-sm px-3 py-2 min-h-[44px]" onclick={onExportCSV}>⤓ Export CSV</button>
    <button class="btn-danger text-sm px-3 py-2 min-h-[44px]" onclick={onEnd}>⨯ End board</button>
  </div>
{:else}
  <div class="inline-flex items-center gap-1 text-xs">
    <input
      bind:value={timerInputMin}
      type="number"
      min="0"
      step="0.5"
      class="input w-14 px-1.5 py-0.5"
      title="Minutes"
    />
    <button class="btn px-2 py-0.5" onclick={onSet}>Set</button>
    <button
      class="btn px-2 py-0.5 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/40"
      onclick={onStart}
    >
      ▶
    </button>
    <button
      class="btn px-2 py-0.5 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/40"
      onclick={onPause}
    >
      ⏸
    </button>
    <button class="btn px-2 py-0.5" onclick={onReset}>⟲</button>
  </div>

  <button class="btn text-xs px-2 py-1" onclick={onExportCSV} title="Export to CSV">
    ⤓ Export CSV
  </button>

  <button class="btn-danger text-xs px-2 py-1" onclick={onEnd} title="Archive & clear board">
    ⨯ End board
  </button>
{/if}
