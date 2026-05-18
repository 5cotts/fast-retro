<script lang="ts">
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
      type="text"
      maxlength="40"
      autofocus
      class={mobile
        ? 'input flex-1 text-sm min-h-[44px] px-2 py-1.5'
        : 'input text-xs w-28 px-1.5 py-0.5'}
      onkeydown={(e) => {
        if (e.key === 'Escape') editing = false;
      }}
    />
    <button
      type="submit"
      class={mobile
        ? 'text-sm px-3 py-2 min-h-[44px] rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
        : 'text-xs px-1.5 py-0.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'}
    >
      Save
    </button>
    <button
      type="button"
      class={mobile ? 'text-sm px-2 py-2 min-h-[44px] text-slate-500' : 'text-xs px-1.5 py-0.5 text-slate-500'}
      onclick={() => (editing = false)}
    >
      ×
    </button>
  </form>
{:else}
  <button
    class={mobile
      ? 'btn text-sm px-3 py-2 min-h-[44px]'
      : 'btn-ghost text-xs px-1.5 py-0.5 border border-slate-200 dark:border-slate-600'}
    onclick={startEdit}
    title="Change your display name"
  >
    ✎ {mobile ? `Name: ${userName}` : userName}
  </button>
{/if}
