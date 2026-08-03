<script lang="ts">
  import { onMount } from 'svelte';

  let { clientId, onSignedIn, darkMode = false } = $props<{
    clientId: string;
    onSignedIn: (credential: string) => void;
    darkMode?: boolean;
  }>();

  let buttonEl = $state<HTMLDivElement | null>(null);
  let failed = $state(false);

  // Google Identity Services is loaded lazily from Google's CDN. It hands us a
  // signed JWT (the "credential") on success, which we forward to the backend
  // for verification — we never see a client secret.
  function loadGis(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') return reject(new Error('no window'));
      const w = window as unknown as { google?: { accounts?: unknown } };
      if (w.google?.accounts) return resolve();
      const existing = document.querySelector<HTMLScriptElement>('script[data-gis]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('gis load failed')));
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.dataset.gis = '1';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('gis load failed'));
      document.head.appendChild(s);
    });
  }

  onMount(async () => {
    if (!clientId) return;
    try {
      await loadGis();
      const g = (window as unknown as {
        google: {
          accounts: {
            id: {
              initialize: (o: unknown) => void;
              renderButton: (el: HTMLElement, o: unknown) => void;
            };
          };
        };
      }).google;
      g.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential?: string }) => {
          if (resp.credential) onSignedIn(resp.credential);
        }
      });
      if (buttonEl) {
        g.accounts.id.renderButton(buttonEl, {
          type: 'standard',
          theme: darkMode ? 'filled_black' : 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'left'
        });
      }
    } catch {
      failed = true;
    }
  });
</script>

<div bind:this={buttonEl} class="flex justify-center"></div>
{#if failed}
  <p class="text-xs text-slate-400 dark:text-slate-500 text-center mt-1">
    Couldn't load Google Sign-In.
  </p>
{/if}
