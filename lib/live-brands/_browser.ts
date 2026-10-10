/**
 * A request that looks like Chrome to a bot manager: HTTP/2, the full
 * `sec-ch-ua` / `sec-fetch-*` header set, and gzip/br.
 *
 * DeFacto (Akamai) and Mavi (Cloudflare) both answer 403 to Node's default
 * fetch — HTTP/1.1 with a bare header set — whatever the user agent says, and
 * also to curl over HTTP/2 without `Accept-Encoding`. The same request with
 * undici's `allowH2` and a browser header set answers 200 (measured
 * 2026-10-10 from a Turkish residential line). Nothing here is a credential or
 * a cookie: it is the request shape the sites' own pages send.
 *
 * Shared by the collector adapters and the single-product resolvers for those
 * two brands. Proxy plumbing comes from ../live-http (never ../live-lookup).
 */
import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { proxyUrlFor } from "../live-http";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let direct: Agent | undefined;
const proxied = new Map<string, ProxyAgent | undefined>();

function directAgent(): Agent {
  return (direct ??= new Agent({ allowH2: true }));
}

/** One h2-capable proxy agent per exit country, built once (see live-http). */
function proxyAgent(country: string): ProxyAgent | undefined {
  if (!proxied.has(country)) {
    const uri = proxyUrlFor(process.env.DATAIMPULSE_PROXY, country);
    proxied.set(country, uri ? new ProxyAgent({ uri, allowH2: true }) : undefined);
  }
  return proxied.get(country);
}

/** Header set for a top-level page load ("document") or a same-origin XHR ("json"). */
export function browserHeaders(kind: "document" | "json", referer?: string): Record<string, string> {
  const nav = kind === "document";
  return {
    accept: nav
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
      : "application/json, text/plain, */*",
    "accept-language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "accept-encoding": "gzip, deflate, br",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": nav ? "document" : "empty",
    "sec-fetch-mode": nav ? "navigate" : "cors",
    "sec-fetch-site": nav ? "none" : referer ? "same-site" : "same-origin",
    ...(nav ? { "sec-fetch-user": "?1", "upgrade-insecure-requests": "1" } : {}),
    ...(referer ? { referer } : {}),
    "user-agent": BROWSER_UA,
  };
}

export interface BrowserFetchOpts {
  kind?: "document" | "json";
  referer?: string;
  /** Exit country for the proxy leg, lowercase ("tr"). */
  country?: string;
  /** Per attempt. The resolvers use 8 s like the rest of live-http. */
  timeoutMs?: number;
  /**
   * "direct-first": the collector's rule — residential bandwidth is paid, so the
   * proxy is only a fallback after a refusal. "proxy-first": the resolver's rule
   * — Vercel egress is datacenter, which is what bot managers refuse.
   */
  order?: "direct-first" | "proxy-first";
}

/**
 * GET `url` as text. Returns null on refusal or network failure (after trying
 * the other leg when a proxy is configured), logging why — a refusal and a
 * miss must not look the same.
 */
export async function browserText(url: string, opts: BrowserFetchOpts = {}): Promise<string | null> {
  const country = opts.country ?? "tr";
  const viaProxy = proxyAgent(country);
  const legs: (Dispatcher | undefined)[] =
    opts.order === "proxy-first" ? [viaProxy ?? directAgent(), ...(viaProxy ? [directAgent()] : [])]
    : [directAgent(), ...(viaProxy ? [viaProxy] : [])];
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  for (const dispatcher of legs) {
    const leg = dispatcher === directAgent() ? "direct" : `${country} proxy`;
    try {
      const r = await fetch(url, {
        headers: browserHeaders(opts.kind ?? "document", opts.referer),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        // @ts-expect-error undici's dispatcher is accepted by Node's fetch
        dispatcher,
      });
      if (r.ok) return await r.text();
      console.warn(`browser-fetch: ${host} refused with HTTP ${r.status} (${leg})`);
      if (r.status === 404) return null; // a miss, not a block: no point retrying
    } catch (err) {
      console.warn(`browser-fetch: ${host} unreachable (${leg}) — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

/** browserText + JSON.parse; null on any failure. */
export async function browserJson<T = any>(url: string, opts: BrowserFetchOpts = {}): Promise<T | null> {
  const t = await browserText(url, { kind: "json", ...opts });
  if (t == null) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}

/**
 * Pull a JSON value that a page inlines into JavaScript (`DataLayer:{…}`,
 * `var catalogModel = {…}`), starting at the first `{` or `[` after `marker`.
 * Brace-balanced and string-aware, so a `}` inside a product name is safe.
 */
export function extractJsonAfter(src: string, marker: string, from = 0): unknown | null {
  const at = src.indexOf(marker, from);
  if (at < 0) return null;
  let i = at + marker.length;
  while (i < src.length && src[i] !== "{" && src[i] !== "[") {
    if (!/\s|=|:/.test(src[i])) return null;
    i++;
  }
  const start = i;
  let depth = 0;
  let inStr = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(src.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Decode the handful of HTML entities these shops put in attributes and names. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Turkish-formatted money ("1.299,99 TL", "649,99") or a plain number → major units. */
export function trMoney(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!s) return NaN;
  return Number(s.replace(/\./g, "").replace(",", "."));
}
