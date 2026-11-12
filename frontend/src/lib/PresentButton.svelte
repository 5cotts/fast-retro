<script lang="ts">
  import { ChevronDown, ExternalLink, Presentation } from 'lucide-svelte';
  import { tick } from 'svelte';

  // Presenting changes only this screen, so it sits beside Share rather than
  // with the board settings in LeadControls, which change the board for
  // everyone. While presenting, the button becomes a dark pill with a red
  // "on air" dot and a Stop button: it's what the team sees on the shared
  // screen, and it tells them the host's input isn't being shown.
  let {
    presenting,
    onPresent,
    onStop,
    mobile = false
  } = $props<{
    presenting: boolean;
    onPresent: () => void;
    onStop: () => void;
    mobile?: boolean;
  }>();

  const GUIDE_HREF = '/docs/run#present';

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let stopEl = $state<HTMLButtonElement | null>(null);

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

  async function present() {
    closeMenu(false);
    onPresent();
    // Keep keyboard focus on the control that replaced the menu.
    await tick();
    stopEl?.focus();
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

{#if presenting}
  <div
    class="inline-flex items-stretch rounded-md overflow-hidden bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm {mobile
      ? 'text-sm min-h-[44px]'
      : 'text-xs min-h-[32px]'}"
    data-testid="presenting-pill"
  >
    <span
      class="inline-flex items-center gap-1.5 font-medium {mobile ? 'px-3' : 'px-2'}"
      role="status"
      title="Presenting: this screen shows the board the way your team sees it. Nobody else's screen changes."
    >
      <span class="relative inline-flex w-2 h-2" aria-hidden="true">
        <span class="absolute inset-0 rounded-full bg-rose-500 motion-safe:animate-ping opacity-60"></span>
        <span class="relative inline-block w-2 h-2 rounded-full bg-rose-500"></span>
      </span>
      Presenting
    </span>
    <button
      bind:this={stopEl}
      type="button"
      class="border-l border-white/20 dark:border-slate-900/20 font-medium hover:bg-white/10 dark:hover:bg-slate-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 {mobile
        ? 'px-3'
        : 'px-2'}"
      aria-label="Stop presenting"
      onclick={onStop}
    >
      Stop
    </button>
  </div>
{:else if mobile}
  <button type="button" class="btn text-sm px-3 py-2 min-h-[44px]" onclick={onPresent}>
    <Presentation size={14} aria-hidden="true" />
    Present
  </button>
{:else}
  <div class="relative" bind:this={rootEl}>
    <button
      bind:this={triggerEl}
      type="button"
      class="btn text-xs px-2 py-1 min-h-[32px]"
      aria-haspopup="menu"
      aria-expanded={open}
      title="Present: share your screen without showing which cards, votes and reactions are yours"
      onclick={() => (open ? closeMenu() : openMenu())}
      onkeydown={onTriggerKeydown}
    >
      <Presentation size={14} aria-hidden="true" />
      <span>Present</span>
      <ChevronDown size={12} aria-hidden="true" class="opacity-60" />
    </button>
    {#if open}
      <div
        bind:this={menuEl}
        role="menu"
        aria-label="Present"
        tabindex="-1"
        onkeydown={onMenuKeydown}
        class="absolute z-30 top-full mt-1.5 right-0 w-72 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
      >
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="w-full flex items-start gap-2.5 text-left rounded-md px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
          onclick={present}
        >
          <Presentation size={16} aria-hidden="true" class="mt-0.5 shrink-0 text-sky-600 dark:text-sky-300" />
          <span class="min-w-0">
            <span class="block text-sm font-medium">Present in this tab</span>
            <span class="block text-xs text-slate-500 dark:text-slate-400">
              Hides which cards, votes and reactions are yours. Voting pauses here.
            </span>
          </span>
        </button>
        <div class="my-1 border-t border-slate-200 dark:border-slate-700" role="separator"></div>
        <a
          href={GUIDE_HREF}
          target="_blank"
          rel="noopener"
          role="menuitem"
          tabindex="-1"
          class="w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
          onclick={() => closeMenu(false)}
        >
          <ExternalLink size={13} aria-hidden="true" class="shrink-0" />
          How presenting works
        </a>
      </div>
    {/if}
  </div>
{/if}
