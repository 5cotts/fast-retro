<script lang="ts">
  import { Check, ChevronDown, ExternalLink, Presentation, X } from 'lucide-svelte';
  import { tick } from 'svelte';

  // Presenting changes only this screen, so it sits beside Share rather than
  // with the board settings in LeadControls, which change the board for
  // everyone. The menu and the reminder open from the button's left edge,
  // since Present comes first in the controls and is never at the right edge
  // of a wrapped header. While presenting, the button becomes a dark pill with a red
  // "on air" dot and a Stop button: it's what the team sees on the shared
  // screen, and it tells them the host's input isn't being shown.
  //
  // `remind` shows a callout under the button the first time someone else
  // joins (rules in presentReminder.ts). It never takes focus, since the host
  // may be typing, and it reveals nothing about their input, so it's fine on a
  // shared screen. Desktop only: on narrow screens shouldRemind is false.
  let {
    presenting,
    onPresent,
    onStop,
    mobile = false,
    remind = false,
    remindersOn = true,
    onReminder = () => {},
    onSetReminders = () => {}
  } = $props<{
    presenting: boolean;
    onPresent: () => void;
    onStop: () => void;
    mobile?: boolean;
    remind?: boolean;
    remindersOn?: boolean;
    onReminder?: (action: 'present' | 'not_now' | 'off') => void;
    onSetReminders?: (on: boolean) => void;
  }>();

  const GUIDE_HREF = '/docs/run#present';

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let stopEl = $state<HTMLButtonElement | null>(null);
  let calloutEl = $state<HTMLDivElement | null>(null);

  function items(): HTMLElement[] {
    return menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')] : [];
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

  function reminderPresent() {
    onReminder('present');
    openMenu();
  }

  // Escape dismisses the reminder, but only when nothing else would want the
  // key: focus is on the page itself or inside the callout.
  $effect(() => {
    if (!remind || open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      const idle = t === document.body || t === document.documentElement;
      if (idle || (calloutEl && t instanceof Node && calloutEl.contains(t))) onReminder('not_now');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

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
        class="absolute z-30 top-full mt-1.5 left-0 w-72 p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
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
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={remindersOn}
          tabindex="-1"
          class="w-full flex items-center gap-2.5 text-left rounded-md px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
          onclick={() => onSetReminders(!remindersOn)}
        >
          <span
            class="inline-flex items-center justify-center w-[13px] h-[13px] shrink-0 rounded-sm border {remindersOn
              ? 'bg-sky-600 border-sky-600 text-white dark:bg-sky-400 dark:border-sky-400 dark:text-slate-900'
              : 'border-slate-400 dark:border-slate-500'}"
            aria-hidden="true"
          >
            {#if remindersOn}<Check size={10} strokeWidth={3} />{/if}
          </span>
          Remind me when people join
        </button>
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
    <!-- A polite live region that's always there, so screen readers announce
         the reminder once when it appears, without moving focus. It sits
         below the header's popovers (z-20 and up), so opening the timer or
         Export while it shows puts that on top instead of under it. -->
    <div class="absolute z-10 top-full left-0 mt-2" aria-live="polite">
      {#if remind && !open}
        <div
          bind:this={calloutEl}
          role="note"
          aria-label="Reminder to present"
          data-testid="present-reminder"
          class="relative w-80 p-3 pr-8 text-left bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-lg shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
        >
          <span
            class="absolute -top-1.5 left-6 w-3 h-3 rotate-45 bg-white dark:bg-slate-800 border-l border-t border-sky-200 dark:border-sky-800"
            aria-hidden="true"
          ></span>
          <button
            type="button"
            class="absolute top-1.5 right-1.5 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700"
            aria-label="Close reminder"
            onclick={() => onReminder('not_now')}
          >
            <X size={14} aria-hidden="true" />
          </button>
          <p class="text-sm text-slate-700 dark:text-slate-200">
            <strong class="font-semibold">Sharing your screen?</strong>
            Present first, so the team can't see which cards, votes and reactions are yours.
          </p>
          <div class="mt-2.5 flex items-center gap-2 text-xs">
            <button type="button" class="btn btn-primary text-xs px-2.5 py-1 min-h-[28px]" onclick={reminderPresent}>
              Present
            </button>
            <button type="button" class="btn text-xs px-2.5 py-1 min-h-[28px]" onclick={() => onReminder('not_now')}>
              Not now
            </button>
            <span class="text-slate-400" aria-hidden="true">·</span>
            <button
              type="button"
              class="text-slate-500 dark:text-slate-400 underline-offset-2 hover:underline"
              onclick={() => onReminder('off')}
            >
              Don't remind me
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
