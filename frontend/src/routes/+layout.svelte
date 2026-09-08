<script lang="ts">
  import '../app.css';
  import { afterNavigate } from '$app/navigation';
  import { browser } from '$app/environment';

  let { children } = $props();

  // gtag's automatic page_view only fires on the initial document load, so
  // client-side route changes (this is an SPA) need to be reported manually.
  afterNavigate(({ to }) => {
    if (!browser || typeof gtag !== 'function' || !to?.url) return;
    gtag('event', 'page_view', {
      page_path: to.url.pathname + to.url.search,
      page_title: document.title
    });
  });
</script>

{@render children?.()}
