<script lang="ts">
  import { onMount } from 'svelte';
  import { track } from './analytics';
  import { FileUp, Sparkles, X } from 'lucide-svelte';
  import { newSlug, slugifyLabel } from './boards';
  import {
    BOARD_FILE_EXTENSION,
    MAX_IMPORT_BYTES,
    describeStats,
    parseBoardFile,
    type BoardFile,
    type ParseResult
  } from './boardfile';

  let { onClose, onConfirm, hostMode = false, initialFile = null } = $props<{
    onClose: () => void;
    onConfirm: (result: { slug: string; label: string; importFile?: BoardFile }) => void;
    hostMode?: boolean;
    // A file dropped on the page before the modal opened.
    initialFile?: File | null;
  }>();

  let labelInput = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let importName = $state('');
  let importResult = $state<ParseResult | null>(null);
  const importing = $derived(importResult?.ok === true);

  let dragging = $state(false);

  function setResult(r: ParseResult) {
    importResult = r;
    if (r.ok) labelInput = r.file.board.label;
    else track({ name: 'board_import', params: { result: 'error', reason: r.code } });
  }

  async function loadFile(file: File) {
    importName = file.name;
    if (file.size > MAX_IMPORT_BYTES) {
      setResult({ ok: false, error: 'This file is too large to import (over 1 MB).', code: 'too_large' });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setResult({ ok: false, error: "Couldn't read that file.", code: 'read_failed' });
      return;
    }
    setResult(parseBoardFile(text));
  }

  function onFilePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) loadFile(file);
  }

  function hasFiles(e: DragEvent): boolean {
    return !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  }

  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function onDragLeave(e: DragEvent) {
    if (e.currentTarget instanceof Node && e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    dragging = false;
  }

  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  }

  function clearImport() {
    importResult = null;
    importName = '';
  }

  onMount(() => {
    inputEl?.focus();
    if (initialFile) loadFile(initialFile);
  });

  // Preview the slug derived from the typed name so the user understands the URL
  // they're about to land on. If the field is empty, fall back to a random slug
  // hint without burning a real one — we only mint the real slug on submit.
  const previewSlug = $derived(slugifyLabel(labelInput) || '— random —');

  function submit(e?: SubmitEvent) {
    e?.preventDefault();
    const label = labelInput.trim().slice(0, 60);
    const base = slugifyLabel(label);
    const slug = base ? `${base}-${newSlug(3)}` : newSlug();
    if (importResult?.ok) {
      const importFile = { ...importResult.file, board: { ...importResult.file.board, label } };
      onConfirm({ slug, label, importFile });
      return;
    }
    onConfirm({ slug, label });
  }

  function skip() {
    onConfirm({ slug: newSlug(), label: '' });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
  onclick={onBackdrop}
>
  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="new-retro-heading"
    tabindex="-1"
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    class="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl w-full max-w-md p-6 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-150"
  >
    {#if dragging}
      <div
        class="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-sky-50/90 dark:bg-sky-900/80 text-sm font-medium text-sky-800 dark:text-sky-100 pointer-events-none"
        aria-hidden="true"
      >
        Drop a .fastretro.json file to import it
      </div>
    {/if}
    <div class="flex items-start gap-3">
      <span
        class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200 shrink-0"
        aria-hidden="true"
      >
        <Sparkles size={18} />
      </span>
      <div class="flex-1 min-w-0">
        <h2 id="new-retro-heading" class="text-lg font-semibold tracking-tight">
          Start a new retro
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Give it a name so you {hostMode ? 'and your team' : ''}can find it later. Optional — leave blank for a quick anonymous board.
        </p>
      </div>
      <button
        type="button"
        class="btn-ghost text-slate-500 dark:text-slate-400 -mr-2 -mt-1 min-h-[32px] min-w-[32px] px-1.5"
        onclick={onClose}
        aria-label="Close"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>

    <form class="mt-5" onsubmit={submit}>
      <label for="new-retro-name" class="text-xs font-medium text-slate-700 dark:text-slate-200">
        Retro name
      </label>
      <input
        bind:this={inputEl}
        bind:value={labelInput}
        id="new-retro-name"
        type="text"
        maxlength="60"
        autocomplete="off"
        placeholder="e.g. Sprint 42 — Mobile"
        class="mt-1 input w-full px-3 py-2.5 min-h-[44px] text-sm"
      />

      <div class="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>URL slug:</span>
        <code class="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 truncate max-w-[16rem]">
          /board/{previewSlug}
        </code>
      </div>

      {#if importResult}
        <div
          class="mt-4 rounded-md border p-3 text-xs {importResult.ok
            ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/30 text-sky-900 dark:text-sky-100'
            : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-100'}"
          role="status"
          aria-label="Import preview"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">{importName}</div>
              {#if importResult.ok}
                <div class="mt-0.5">{describeStats(importResult.stats, importResult.file.board.anonymous)}</div>
                {#each importResult.warnings as w (w)}
                  <div class="mt-1 text-amber-800 dark:text-amber-200">{w}</div>
                {/each}
              {:else}
                <div class="mt-0.5">{importResult.error}</div>
              {/if}
            </div>
            <button type="button" class="btn-ghost text-xs px-1.5 py-0.5" onclick={clearImport}>
              Remove
            </button>
          </div>
        </div>
      {/if}

      <div class="mt-5 flex items-center gap-2">
        <button
          type="submit"
          disabled={importResult !== null && !importResult.ok}
          class="flex-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md py-2.5 min-h-[44px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {importing ? 'Import retro' : 'Create retro'}
        </button>
        {#if !importResult}
          <button
            type="button"
            class="btn text-sm px-4 py-2 min-h-[44px]"
            onclick={skip}
          >
            Skip naming
          </button>
        {/if}
      </div>

      <div class="mt-3 text-center">
        <input
          bind:this={fileInputEl}
          type="file"
          accept={`${BOARD_FILE_EXTENSION},.json,application/json`}
          class="sr-only"
          tabindex="-1"
          aria-label="Board file to import"
          onchange={onFilePicked}
        />
        <button
          type="button"
          class="btn-ghost text-xs px-2 py-1 text-slate-600 dark:text-slate-300"
          onclick={() => fileInputEl?.click()}
        >
          <FileUp size={14} aria-hidden="true" />
          Import from file…
        </button>
        <span class="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">or drop it here</span>
      </div>
    </form>
  </div>
</div>
