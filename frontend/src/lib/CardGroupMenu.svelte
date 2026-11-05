<script lang="ts">
  import { Layers } from 'lucide-svelte';
  import { tick } from 'svelte';
  import { clusterDisplayName, MAX_CLUSTER_LABEL_LEN, type ClusterDef } from './clusters';

  // Grouping without a drag, for touch and keyboard users: join a group, start
  // a new one, or leave. A new group needs a name, because a one-card group with
  // no name displays as a normal card and the choice would seem to do nothing.
  let {
    groups,
    currentId,
    onJoin,
    onCreate,
    onLeave
  } = $props<{
    groups: ClusterDef[];
    // The group this card shows in, if any.
    currentId: string | null;
    onJoin: (clusterId: string) => void;
    onCreate: (label: string) => void;
    onLeave: () => void;
  }>();

  let open = $state(false);
  let naming = $state(false);
  let newName = $state('');
  let alignRight = $state(false);
  let alignUp = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let nameEl = $state<HTMLInputElement | null>(null);

  const others = $derived(groups.filter((g: ClusterDef) => g.id !== currentId));

  function items(): HTMLElement[] {
    return menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
  }

  async function openMenu() {
    // Same clamp as the reaction picker: stay inside the viewport.
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      alignRight = rect.left + 240 > window.innerWidth;
      alignUp = window.innerHeight - rect.bottom < 240 && rect.top > 240;
    }
    naming = false;
    newName = '';
    open = true;
    await tick();
    items()[0]?.focus();
  }

  function closeMenu(restoreFocus = true) {
    open = false;
    naming = false;
    if (restoreFocus) triggerEl?.focus();
  }

  function choose(action: () => void) {
    closeMenu();
    action();
  }

  async function startNaming() {
    naming = true;
    await tick();
    nameEl?.focus();
  }

  function submitName() {
    const t = newName.trim();
    if (t) choose(() => onCreate(t));
  }

  function onMenuKeydown(e: KeyboardEvent) {
    // Stay out of the card's Shift+arrow move, and of the page's own shortcuts.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key === 'Tab' && !naming) {
      closeMenu(false);
      return;
    }
    if (naming) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
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
    class="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 min-h-[40px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors {currentId ? 'border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-200' : ''}"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Group this card"
    title="Group this card with others"
    onclick={() => (open ? closeMenu() : openMenu())}
  >
    <Layers size={14} aria-hidden="true" />
    <span>Group</span>
  </button>
  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      aria-label="Group this card"
      tabindex="-1"
      onkeydown={onMenuKeydown}
      class="absolute z-30 w-56 max-h-64 overflow-y-auto p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg {alignRight ? 'right-0' : 'left-0'} {alignUp ? 'bottom-full mb-1' : 'top-full mt-1'}"
    >
      {#each others as g (g.id)}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="w-full text-left text-sm rounded-md px-2.5 py-2 break-words hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
          onclick={() => choose(() => onJoin(g.id))}
        >
          {clusterDisplayName(g)}
        </button>
      {/each}
      {#if naming}
        <form
          class="flex gap-1 p-1"
          onsubmit={(e) => {
            e.preventDefault();
            submitName();
          }}
        >
          <input
            bind:this={nameEl}
            bind:value={newName}
            type="text"
            maxlength={MAX_CLUSTER_LABEL_LEN}
            aria-label="New group name"
            placeholder="Group name"
            class="input flex-1 min-w-0 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            class="text-xs px-2.5 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md font-medium disabled:opacity-40"
          >
            Create
          </button>
        </form>
      {:else}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="w-full text-left text-sm rounded-md px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
          onclick={startNaming}
        >
          New group…
        </button>
      {/if}
      {#if currentId}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="w-full text-left text-sm rounded-md px-2.5 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 focus:bg-slate-100 dark:focus:bg-slate-700 outline-none"
          onclick={() => choose(onLeave)}
        >
          Remove from group
        </button>
      {/if}
    </div>
  {/if}
</div>
