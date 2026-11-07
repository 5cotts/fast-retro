import { redirect } from '@sveltejs/kit';
import { legacyGuideRedirect } from '$lib/guide/pages';

export function load({ url }: { url: URL }) {
  const to = legacyGuideRedirect(url.searchParams.get('role'));
  if (to) redirect(307, to);
}
