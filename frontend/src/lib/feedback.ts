// The "Send feedback" link opens a public GitHub issue form, so what the app
// adds to it is deliberately tiny: the build and a coarse browser name, both
// already visible to anyone who loads the site. Never add the board URL, its
// name, a participant name or card text here. A board link is a password, and
// the page the link is clicked on is a board.

export interface FeedbackContext {
  version?: string | null;
  userAgent?: string;
}

export function shortVersion(sha: string | null | undefined): string | null {
  const m = /^[0-9a-f]{7,40}(-dirty)?$/.exec(sha ?? '');
  return m ? (sha as string).slice(0, 7) + (m[1] ?? '') : null;
}

export function browserSummary(ua: string): string | null {
  // Order matters: Edge and Chrome both say Chrome, Chrome also says Safari.
  const browsers: Array<[string, RegExp]> = [
    ['Edge', /Edg\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/]
  ];
  let browser: string | null = null;
  for (const [name, re] of browsers) {
    const m = re.exec(ua);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  if (!browser) return null;
  const oses: Array<[string, RegExp]> = [
    ['Android', /Android/],
    ['iOS', /iPhone|iPad|iPod/],
    ['Windows', /Windows/],
    ['macOS', /Macintosh|Mac OS X/],
    ['ChromeOS', /CrOS/],
    ['Linux', /Linux/]
  ];
  const os = oses.find(([, re]) => re.test(ua))?.[0];
  return os ? `${browser} on ${os}` : browser;
}

// GitHub issue forms read prefilled values from query parameters named after
// the form field ids (`version`, `browser`). Parameters a page doesn't use,
// such as on the template chooser, are ignored.
export function feedbackHref(base: string, ctx: FeedbackContext = {}): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return base;
  const version = shortVersion(ctx.version);
  const browser = ctx.userAgent ? browserSummary(ctx.userAgent) : null;
  if (version) url.searchParams.set('version', version);
  if (browser) url.searchParams.set('browser', browser);
  return url.toString();
}
