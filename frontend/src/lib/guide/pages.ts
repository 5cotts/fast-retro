// The one list of user guide pages. It drives the landing cards, the sidebar,
// previous/next links and each page's heading, so adding a page is one entry
// here plus one route under routes/docs/.
export type GuideAudience = 'Everyone' | 'Hosts' | 'Participants';

export const GUIDE_PAGES = [
  { slug: 'join', title: 'Join a retro', summary: 'Open the link, pick a name, and follow the phases.', audience: 'Participants' },
  { slug: 'run', title: 'Run your first retro', summary: 'Start a board, share it, and walk your team through the phases.', audience: 'Hosts' },
  { slug: 'group', title: 'Group and merge cards', summary: 'Pull related cards together on a column board, across columns too.', audience: 'Everyone' },
  { slug: 'canvas', title: 'Use a canvas board', summary: 'Place cards anywhere. How close they sit is the grouping.', audience: 'Everyone' },
  { slug: 'brainstorm', title: 'Run a private brainstorm', summary: 'One column per problem, ideas hidden until you reveal them.', audience: 'Hosts' },
  { slug: 'setup', title: 'Set up and change a board', summary: 'Choose a board type, then change columns and options at any point.', audience: 'Hosts' },
  { slug: 'save', title: 'Save, export and start the next retro', summary: 'Keep a copy of a board, import it later, and carry on next time.', audience: 'Everyone' },
  { slug: 'reference', title: 'Reference', summary: 'Who can do what in each phase, keyboard shortcuts, and privacy.', audience: 'Everyone' }
] as const satisfies readonly { slug: string; title: string; summary: string; audience: GuideAudience }[];

export type GuidePage = (typeof GUIDE_PAGES)[number];
export type GuideSlug = GuidePage['slug'];

export function guidePath(slug: GuideSlug): string {
  return `/docs/${slug}`;
}

// The page a /docs/... path shows, or null for the landing page and anything
// unknown. A trailing slash is allowed (see trailingSlash in +layout.ts).
export function guidePageFor(pathname: string): GuidePage | null {
  const slug = pathname.replace(/\/+$/, '').split('/').pop();
  return GUIDE_PAGES.find((p) => p.slug === slug) ?? null;
}

export function adjacentGuidePages(slug: GuideSlug): { previous: GuidePage | null; next: GuidePage | null } {
  const i = GUIDE_PAGES.findIndex((p) => p.slug === slug);
  return { previous: GUIDE_PAGES[i - 1] ?? null, next: GUIDE_PAGES[i + 1] ?? null };
}

// Before the guide had pages, /docs?role=... picked a tab. Those links are in
// older copies of the app and in chat history, so they keep working.
export function legacyGuideRedirect(role: string | null): string | null {
  if (role === 'lead') return guidePath('run');
  if (role === 'participant') return guidePath('join');
  return null;
}
