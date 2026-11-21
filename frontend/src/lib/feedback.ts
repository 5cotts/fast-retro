// The "Send feedback" link opens a public GitHub issue form, so what the app
// adds to it is deliberately tiny: the build, a coarse browser name and, on a
// board, its reference code (see validBoardRef). Never add the board URL, its
// name, a participant name or card text here. A board link is a password, and
// the page the link is clicked on is a board.

export interface FeedbackContext {
  version?: string | null;
  userAgent?: string;
  boardRef?: string | null;
}

// A board reference (`7f3a-9c1e-b204`) is a keyed code the server derives from
// the board's slug. It names the board for whoever runs the server but can't
// be turned back into the slug, so unlike the board link it's safe to put in a
// public report. Anything that isn't that exact shape is dropped, so nothing
// else can ride along in its place.
export function validBoardRef(ref: string | null | undefined): string | null {
  return /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/.test(ref ?? '') ? (ref as string) : null;
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
// the form field ids (`version`, `browser`, `board_ref`). Parameters a page doesn't use,
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
  const boardRef = validBoardRef(ctx.boardRef);
  if (boardRef) url.searchParams.set('board_ref', boardRef);
  return url.toString();
}
