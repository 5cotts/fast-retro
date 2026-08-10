<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    newSlug,
    readRecentBoards,
    recordRecentBoard,
    setPendingLabel,
    setHostKey,
    type RecentBoard
  } from '$lib/boards';
  import {
    fetchConfig,
    fetchMe,
    fetchMyBoards,
    createBoard,
    signInWithGoogle,
    signOut,
    type MeUser,
    type MyBoard
  } from '$lib/api';
  import Wordmark from '$lib/Wordmark.svelte';
  import NewRetroModal from '$lib/NewRetroModal.svelte';
  import GoogleSignIn from '$lib/GoogleSignIn.svelte';
  import { getTheme } from '$lib/storage';
  import { LogOut, Loader2 } from 'lucide-svelte';

  let recents = $state<RecentBoard[]>([]);
  let ready = $state(false);
  let showNewModal = $state(false);
  let creating = $state(false);
  let createError = $state('');

  let googleEnabled = $state(false);
  let googleClientId = $state('');
  let user = $state<MeUser | null>(null);
  let myBoards = $state<MyBoard[]>([]);
  let darkMode = $state(false);

  onMount(async () => {
    recents = readRecentBoards();
    const pref = getTheme();
    darkMode =
      pref === 'dark' ||
      (pref === 'auto' &&
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches);

    const [cfg, me] = await Promise.all([fetchConfig(), fetchMe()]);
    googleEnabled = cfg.googleEnabled;
    googleClientId = cfg.googleClientId;
    user = me;
    if (me) myBoards = await fetchMyBoards();
    ready = true;
  });

  function createFresh() {
    createError = '';
    showNewModal = true;
  }

  async function onNewConfirm({ slug, label }: { slug: string; label: string }) {
    showNewModal = false;
    creating = true;
    createError = '';
    try {
      let result = await createBoard(slug, label).catch(() => null);
      // Extremely rare slug collision — retry once with a fresh random slug.
      if (!result) result = await createBoard(newSlug(), label);
      setHostKey(result.slug, result.hostKey);
      if (label) {
        recordRecentBoard(result.slug, { label });
        setPendingLabel(result.slug, label);
      }
      goto(`/board/${result.slug}`);
    } catch {
      creating = false;
      createError = "Couldn't create the retro. Try again.";
    }
  }

  async function handleSignIn(credential: string) {
    const me = await signInWithGoogle(credential).catch(() => null);
    if (me) {
      user = me;
      myBoards = await fetchMyBoards();
    }
  }

  async function handleSignOut() {
    await signOut();
    user = null;
    myBoards = [];
  }

  function open(slug: string) {
    goto(`/board/${slug}`);
  }

  // Prefer the server-backed "my retros" list when signed in; fall back to the
  // device-local recents for guests.
  const showMyBoards = $derived(user && myBoards.length > 0);
</script>

{#if ready}
  <div class="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6 text-slate-900 dark:text-slate-100">
    <div class="w-full max-w-md">
      <div class="text-center mb-6">
        <div class="flex items-center justify-center mb-2">
          <Wordmark size="lg" />
        </div>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Start a retro and share the link. Whoever starts it hosts it.
        </p>
      </div>

      <button
        onclick={createFresh}
        disabled={creating}
        class="w-full inline-flex items-center justify-center gap-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-3 min-h-[44px] text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {#if creating}
          <Loader2 size={15} class="animate-spin" aria-hidden="true" /> Creating…
        {:else}
          Start a new retro
        {/if}
      </button>
      {#if createError}
        <p class="mt-2 text-xs text-rose-600 dark:text-rose-400 text-center">{createError}</p>
      {/if}

      <!-- Account -->
      <div class="mt-4">
        {#if user}
          <div class="flex items-center justify-between gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
            <span class="flex items-center gap-2 min-w-0">
              {#if user.avatarUrl}
                <img src={user.avatarUrl} alt="" class="w-6 h-6 rounded-full" />
              {/if}
              <span class="text-sm truncate">Signed in as <span class="font-medium">{user.name || user.email}</span></span>
            </span>
            <button
              class="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1"
              onclick={handleSignOut}
            >
              <LogOut size={13} aria-hidden="true" /> Sign out
            </button>
          </div>
        {:else if googleEnabled}
          <div class="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-3">
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-2 text-center">
              Sign in to keep host access. Without it, clearing your browser or switching devices locks you out of your own retro for good.
            </p>
            <GoogleSignIn clientId={googleClientId} onSignedIn={handleSignIn} {darkMode} />
          </div>
        {/if}
      </div>

      <!-- My retros (signed in) or recent boards (guests) -->
      {#if showMyBoards}
        <div class="mt-8">
          <h2 class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">My retros</h2>
          <ul class="border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {#each myBoards.slice(0, 12) as b (b.slug)}
              <li>
                <button
                  class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  onclick={() => open(b.slug)}
                >
                  <span class="flex-1 min-w-0 flex flex-col">
                    <span class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                      {b.label || b.slug}
                    </span>
                    <span class="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">{b.slug}</span>
                  </span>
                  <span class="flex items-center gap-1.5 shrink-0">
                    {#if b.isOwner}
                      <span class="text-[10px] rounded px-1.5 py-0.5 bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">Host</span>
                    {/if}
                    {#if b.ended}
                      <span class="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">Ended</span>
                    {/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {:else if recents.length > 0}
        <div class="mt-8">
          <h2 class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Recent boards</h2>
          <ul class="border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
            {#each recents.slice(0, 8) as r (r.slug)}
              <li>
                <button
                  class="w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
                  onclick={() => open(r.slug)}
                >
                  <span class="flex-1 min-w-0 flex flex-col">
                    {#if r.label}
                      <span class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{r.label}</span>
                      <span class="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">{r.slug}</span>
                    {:else}
                      <span class="font-mono text-sm text-slate-700 dark:text-slate-200 truncate">{r.slug}</span>
                    {/if}
                  </span>
                  <span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    {new Date(r.lastVisited).toLocaleDateString()}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <p class="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
        New here?
        <a href="/docs" class="text-sky-600 dark:text-sky-400 hover:underline">Read the user guide</a>.
      </p>
    </div>
  </div>
{/if}

{#if showNewModal}
  <NewRetroModal onClose={() => (showNewModal = false)} onConfirm={onNewConfirm} hostMode={true} />
{/if}
