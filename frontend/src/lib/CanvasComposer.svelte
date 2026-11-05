<script lang="ts">
  import { COLUMN_PLACEHOLDER, COLUMN_STYLE, type ColumnDef } from './columns';

  // The bar under a canvas during Brainstorm: pick a prompt, write a card. The
  // card lands under that prompt's heading. The surface owns the selected
  // prompt, because a double-click on the canvas uses it too.
  interface Props {
    prompts: ColumnDef[];
    activeKey: string;
    typers: string[];
    coarsePointer: boolean;
    onSelect: (key: string) => void;
    onAdd: (column: string, text: string) => void;
    onTyping: (target: string | null) => void;
  }

  let { prompts, activeKey, typers, coarsePointer, onSelect, onAdd, onTyping }: Props = $props();

  let draft = $state('');
  const active = $derived(prompts.find((p) => p.key === activeKey) ?? prompts[0]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(active.key, text);
    draft = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div
  class="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
  data-testid="canvas-composer"
>
  <div class="flex items-center gap-1 overflow-x-auto pb-1.5" role="radiogroup" aria-label="Prompt">
    {#each prompts as prompt (prompt.key)}
      <label
        class="inline-flex items-center gap-1.5 shrink-0 max-w-[16rem] rounded-full border px-2.5 py-1 text-xs cursor-pointer select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-400 {prompt.key === active.key
          ? 'border-slate-400 dark:border-slate-400 bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-slate-100'
          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}"
      >
        <input
          type="radio"
          name="canvas-composer-prompt"
          value={prompt.key}
          checked={prompt.key === active.key}
          onchange={() => onSelect(prompt.key)}
          class="sr-only"
        />
        <span class="size-2 rounded-full shrink-0 {COLUMN_STYLE[prompt.color].dot}" aria-hidden="true"></span>
        <span class="truncate">{prompt.title}</span>
      </label>
    {/each}
  </div>
  <div class="flex items-start gap-2">
    <textarea
      bind:value={draft}
      onkeydown={onKey}
      onfocus={() => onTyping(`new-${active.key}`)}
      onblur={() => onTyping(null)}
      placeholder={COLUMN_PLACEHOLDER}
      rows="1"
      aria-label={`Add a card to ${active.title}`}
      class="input flex-1 min-w-0 resize-none px-2.5 py-2 text-sm leading-snug"
    ></textarea>
    <button
      onclick={submit}
      disabled={!draft.trim()}
      class="bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm rounded-md px-3 py-2 font-medium whitespace-nowrap hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
    >
      Add card
    </button>
  </div>
  <!-- Always takes its line, so someone typing doesn't resize the canvas. -->
  <div class="min-h-4 pl-1 mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
    {#if typers.length > 0}
      <span class="italic text-slate-500 dark:text-slate-400">{typers.join(', ')} typing…</span>
    {:else if !coarsePointer}
      <span class="hidden sm:inline">Enter to add, Shift+Enter for a new line. Double-click the canvas to place a card there.</span>
    {/if}
  </div>
</div>
