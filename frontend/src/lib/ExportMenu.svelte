<script lang="ts">
  import { ChevronDown, Download, FileJson, Sheet } from 'lucide-svelte';
  import { tick } from 'svelte';

  // One "Export" menu instead of a button per file format. Items are named by
  // what the user wants to do, with the format as secondary text.
  let { onSaveBoardFile, onExportCSV, compact = false } = $props<{
    onSaveBoardFile: () => void;
    onExportCSV: () => void;
    compact?: boolean;
  }>();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);

  function items(): HTMLElement[] {
    return menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
  }

  async function openMenu(focusLast = false) {
    open = true;
    await tick();
    const list = items();
    (focusLast ? list[list.length - 1] : list[0])?.focus();
  }

  function closeMenu(restoreFocus = true) {
    open = false;
    if (restoreFocus) triggerEl?.focus();
  }

  function choose(action: () => void) {
    closeMenu();
    action();
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(e.key === 'ArrowUp');
    }
  }

  function onMenuKeydown(e: KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  }

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootEl && e.target instanceof Node && !rootEl.contains(e.target)) closeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });
</script>

<div class="relative" bind:this={rootEl}>
  <button
    bind:this={triggerEl}
    type="button"
    class={compact ? 'btn text-xs px-2 py-1 min-h-[32px]' : 'btn text-sm px-3 py-2 min-h-[44px]'}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Export"
    title="Export this board"
    onclick={() => (open ? closeMenu() : openMenu())}
    onkeydown={onTriggerKeydown}
  >
    <Download size={14} aria-hidden="true" />
    <span class={compact ? 'hidden lg:inline' : ''}>Export</span>
    <ChevronDown size={12} aria-hidden="true" class="opacity-60" />
  </button>
  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      aria-label="Export"
      tabindex="-1"
      onkeydown={onMenuKeydown}
      class="absolute z-30 top-full mt-1.5 w-64 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150 {compact
        ? 'right-0'
        : 'left-0'}"
    >
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="w-full flex items-start gap-2.5 text-left rounded-md px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
        onclick={() => choose(onSaveBoardFile)}
      >
        <FileJson size={16} aria-hidden="true" class="mt-0.5 shrink-0 text-sky-600 dark:text-sky-300" />
        <span class="min-w-0">
          <span class="block text-sm font-medium">Save board file</span>
          <span class="block text-xs text-slate-500 dark:text-slate-400">Full copy to import later · .fastretro.json</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        class="w-full flex items-start gap-2.5 text-left rounded-md px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
        onclick={() => choose(onExportCSV)}
      >
        <Sheet size={16} aria-hidden="true" class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <span class="min-w-0">
          <span class="block text-sm font-medium">Spreadsheet (CSV)</span>
          <span class="block text-xs text-slate-500 dark:text-slate-400">For Sheets or Excel · can't be imported</span>
        </span>
      </button>
    </div>
  {/if}
</div>
