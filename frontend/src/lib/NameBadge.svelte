<script lang="ts">
  import { Pencil, Check, X } from 'lucide-svelte';

  let {
    userName,
    onChange,
    mobile = false
  } = $props<{
    userName: string;
    onChange: (newName: string) => void;
    mobile?: boolean;
  }>();

  let editing = $state(false);
  let value = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  function startEdit() {
    value = userName;
    editing = true;
  }

  $effect(() => {
    if (editing) inputEl?.focus();
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const t = value.trim().slice(0, 40);
    if (!t || t === userName) {
      editing = false;
      return;
    }
    onChange(t);
    editing = false;
  }
</script>

{#if editing}
  <form
    class={mobile ? 'flex items-center gap-1.5 w-full' : 'inline-flex items-center gap-1'}
    onsubmit={submit}
  >
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:value
      bind:this={inputEl}
      type="text"
      maxlength="40"
      autofocus
      aria-label="Display name"
      class={mobile
        ? 'input flex-1 text-sm min-h-[44px] px-2 py-1.5'
        : 'input text-xs w-28 px-1.5 py-0.5 min-h-[32px]'}
      onkeydown={(e) => {
        if (e.key === 'Escape') editing = false;
      }}
    />
    <button
      type="submit"
      class={mobile
        ? 'inline-flex items-center justify-center text-sm px-3 py-2 min-h-[44px] rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 transition-opacity'
        : 'inline-flex items-center justify-center text-xs px-1.5 py-0.5 min-h-[32px] rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 transition-opacity'}
      aria-label="Save name"
    >
      <Check size={14} aria-hidden="true" />
    </button>
    <button
      type="button"
      class={mobile
        ? 'inline-flex items-center justify-center text-sm px-2 py-2 min-h-[44px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors'
        : 'inline-flex items-center justify-center text-xs px-1.5 py-0.5 min-h-[32px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors'}
      onclick={() => (editing = false)}
      aria-label="Cancel"
    >
      <X size={14} aria-hidden="true" />
    </button>
  </form>
{:else}
  <button
    class={mobile
      ? 'btn text-sm px-3 py-2 min-h-[44px]'
      : 'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 min-h-[32px] rounded-full border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors'}
    onclick={startEdit}
    aria-label={`You are ${userName}. Click to change name.`}
    title="Change your display name"
  >
    <span class="truncate max-w-[140px]">{mobile ? `Name: ${userName}` : userName}</span>
    <Pencil size={mobile ? 14 : 12} aria-hidden="true" class="opacity-60" />
  </button>
{/if}
