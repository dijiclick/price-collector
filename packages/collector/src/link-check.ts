/**
 * Does a product's link still open the product? (2026-10-20)
 *
 * Owner report: tapping "open on site" on a Calvin Klein bag landed on
 * tr.calvinklein.com/kadin — the shop had pulled the product page but its
 * PersonaClick feed still listed it in stock, so the collector kept it alive.
 * This module follows a product url's redirects and says whether the shop
 * still answers it with a product page.
 *
 * It only ever calls a link BROKEN on clear evidence:
 *   gone  — the final answer is 404 or 410
 *   moved — a redirect chain that ends on a category, a section or the home
 *           page (see `isListingRedirect`)
 * Everything a bot wall or a bad network can cause — 403, 429, 5xx, a timeout,
 * a TLS error, a redirect to a captcha or a country picker — is `unknown`, and
 * `unknown` never hides anything. A shop blocking our IP must not empty its
 * catalogue from the app.
 *
 * Platform-free (only global fetch) so the host job and tests share it.
 */

export type LinkVerdict = "ok" | "gone" | "moved" | "unknown";

export interface LinkResult {
  verdict: LinkVerdict;
  /** HTTP status of the last answer, null when nothing answered. */
  http: number | null;
  /** Where the redirect chain ended, null when nothing answered. */
  finalUrl: string | null;
  /** Why it is unknown / moved, for the log. */
  note?: string;
}

export const LINK_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Path segments that are locale prefixes, not content: tr, tr-tr, en_GB, … */
const LOCALE_SEG = /^[a-z]{2}([-_][a-z]{2})?$/i;

/** Landing pages that mean "we could not tell", never "the product is gone". */
const NEUTRAL_PATH =
  /(captcha|challenge|blocked|access-denied|denied|robot|bot-|cdn-cgi|login|giris|sign-?in|account|country|geo|region|select|choose|locale|supported-browsers|maintenance|bakim|error|hata)/i;

/** Digit runs long enough to be a product/variant id (5+), from a url. */
export function idTokens(url: string): string[] {
  return [...new Set(url.match(/\d{5,}/g) ?? [])];
}

function contentSegments(u: URL): string[] {
  return u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => decodeURIComponent(s).toLowerCase())
    .filter((s, i) => !(i === 0 && LOCALE_SEG.test(s)));
}

/** The product slug: the last path segment, or a query value when the path has none. */
function slugOf(u: URL): string {
  const segs = contentSegments(u);
  return segs[segs.length - 1] ?? "";
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * Did a redirect chain that started on product url `from` end on a listing
 * (category, section, search, home) of the same shop instead of a product?
 *
 * A redirect that keeps the product's identity is fine — a canonical slug, a
 * colour variant, an added locale, http→https. The test is that the end url
 * carries none of what identified the product (no id token of the original,
 * not its slug) AND is plainly a listing: the home page, a shorter path, or
 * a page named like the start of the product's own slug
 * (/kadin-hardware-flap-omuz-cantasi-p_199754 → /kadin).
 *
 * Another host is never a listing: that is how geo redirects look
 * (zenpirlanta.com → zen-diamond.de from a German IP, calvinklein.us →
 * calvinklein.ie), and a vantage point abroad must not hide a Turkish shop.
 * Neutral landings (captcha, login, country picker) are never a listing.
 */
export function isListingRedirect(from: string, to: string): boolean {
  let a: URL, b: URL;
  try {
    a = new URL(from);
    b = new URL(to);
  } catch {
    return false;
  }
  if (bareHost(a.hostname) !== bareHost(b.hostname)) return false;
  if (NEUTRAL_PATH.test(b.pathname)) return false;
  const toFull = decodeURIComponent(b.pathname + b.search).toLowerCase();
  if (idTokens(from).some((t) => toFull.includes(t))) return false;
  const slug = slugOf(a);
  if (slug.length >= 6 && toFull.includes(slug)) return false;
  const fromSegs = contentSegments(a);
  const toSegs = contentSegments(b);
  if (toSegs.length === 0) return true; // the home page (or a bare locale root)
  // Same depth or deeper with a different slug is a renamed product as often
  // as a listing (Modanisa's /en/…-9347433.html → a Turkish slug with no id);
  // only a shorter path, or a parent-category name, is clear evidence.
  if (toSegs.length < fromSegs.length) return true;
  const last = toSegs[toSegs.length - 1];
  if (toSegs.length === fromSegs.length && last.length >= 3 && slug.startsWith(last + "-")) return true;
  return false;
}

const samePath = (a: string, b: string): boolean => {
  try {
    const norm = (u: string) => new URL(u).pathname.replace(/\/+$/, "").toLowerCase();
    return norm(a) === norm(b);
  } catch {
    return false;
  }
};

/** The verdict for a chain that ended with `status` at `finalUrl`. Pure, for tests. */
export function verdictFor(original: string, status: number | null, finalUrl: string | null): LinkResult {
  if (status === null || finalUrl === null) return { verdict: "unknown", http: status, finalUrl, note: "no answer" };
  // 404/410 counts only on the product's own path (a redirect that changed
  // the path first — Showpo's /au/ → /row/au/ for a foreign visitor — is the
  // redirect's 404, not the product's).
  if (status === 404 || status === 410) {
    return samePath(original, finalUrl)
      ? { verdict: "gone", http: status, finalUrl }
      : { verdict: "unknown", http: status, finalUrl, note: "404 after a redirect" };
  }
  if (status >= 200 && status < 300) {
    if (finalUrl !== original && isListingRedirect(original, finalUrl)) {
      return { verdict: "moved", http: status, finalUrl };
    }
    return { verdict: "ok", http: status, finalUrl };
  }
  return { verdict: "unknown", http: status, finalUrl, note: `http ${status}` };
}

/**
 * Follow `url`'s redirects (GET, at most 8 hops) and judge where it ends.
 * Never throws. The body is never read beyond what fetch buffers.
 */
export async function checkLink(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<LinkResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  let cur = url;
  try {
    for (let hop = 0; hop <= 8; hop++) {
      const res = await doFetch(cur, {
        method: "GET",
        redirect: "manual",
        signal: deadline,
        headers: {
          "user-agent": LINK_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
        },
      });
      try {
        await res.body?.cancel();
      } catch {
        /* already closed */
      }
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        cur = new URL(loc, cur).toString();
        continue;
      }
      return verdictFor(url, res.status, cur);
    }
    return { verdict: "unknown", http: null, finalUrl: cur, note: "redirect loop" };
  } catch (err) {
    return { verdict: "unknown", http: null, finalUrl: null, note: err instanceof Error ? err.name : "error" };
  }
}

/**
 * Run `fn` over `items` with at most `perKey` in flight per key (a shop's
 * host) and `total` overall. Shops are visited side by side, but each one sees
 * at most `perKey` requests at a time, spaced by `gapMs`.
 */
export async function politeMap<T, R>(
  items: T[],
  keyOf: (t: T) => string,
  fn: (t: T) => Promise<R>,
  { perKey = 2, total = 16, gapMs = 400 }: { perKey?: number; total?: number; gapMs?: number } = {},
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  const queues = new Map<string, number[]>();
  items.forEach((t, i) => {
    const k = keyOf(t);
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k)!.push(i);
  });
  // One worker list per key, `perKey` wide; the global cap is a semaphore.
  let inFlight = 0;
  const waiters: (() => void)[] = [];
  const acquire = () =>
    inFlight < total ? (inFlight++, Promise.resolve()) : new Promise<void>((r) => waiters.push(() => (inFlight++, r())));
  const release = () => {
    inFlight--;
    waiters.shift()?.();
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.all(
    [...queues.values()].flatMap((q) =>
      Array.from({ length: Math.min(perKey, q.length) }, async () => {
        for (let i = q.shift(); i !== undefined; i = q.shift()) {
          await acquire();
          try {
            out[i] = await fn(items[i]);
          } finally {
            release();
          }
          if (gapMs) await sleep(gapMs);
        }
      }),
    ),
  );
  return out;
}
