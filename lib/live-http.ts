/**
 * The fetch plumbing every single-product lookup shares: the residential proxy
 * per market, the 8 s timeout, and the "refused / unreachable" logging. Split
 * out of live-lookup.ts (2026-10-10) so a brand's resolver can live in its own
 * file under lib/live-brands/ without importing live-lookup — which imports the
 * resolvers — and making a cycle.
 */
import { ProxyAgent, type Dispatcher } from "undici";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Mango's orchestrator sits behind Akamai, which answers GitHub Actions but
 * returns 403 to Vercel's datacenter egress — verified in production, not
 * assumed. So the lookup goes out through the same residential proxy the
 * collector already knows about when one is configured.
 *
 * Unset is a supported state: the request simply goes direct, which is what the
 * collector does today and what works for brands that do not block. The agent
 * is built once — a ProxyAgent per request leaks sockets in a warm lambda.
 */
/**
 * Which country a brand's shop serves, and therefore which exit the request
 * should leave from. A Turkish shop answered from a German IP is the request
 * most likely to be challenged, priced differently, or served another locale.
 * Every brand here is Turkish today; the map exists so adding a market is a
 * line rather than a refactor.
 */
const BRAND_COUNTRY: Record<string, string> = {};
export const DEFAULT_COUNTRY = "tr";

/**
 * Which exit a request for `brand` should leave from.
 *
 * `country` is the MARKET being read, when the caller knows it — a pasted
 * `zara.com/uk/en/…` is a British storefront and answering it from a Turkish IP
 * is the request most likely to be challenged or priced differently. A brand
 * pinned in `BRAND_COUNTRY` still wins: some shops only answer one exit
 * whatever url you ask for, and that is a property of the shop.
 */
export const countryFor = (brand: string | undefined, country?: CountryLike): string =>
  (brand && BRAND_COUNTRY[brand]) || (country ? String(country).toLowerCase() : DEFAULT_COUNTRY);

/** Accepts either an ISO code ("GB") or an already-lowercased exit ("gb"). */
type CountryLike = string;

/**
 * DataImpulse selects the exit country through the USERNAME, not the host:
 * `user__cr.tr:pass@gw.dataimpulse.com:823`. So one credential serves every
 * market and the country is appended per request.
 *
 * A base url that already carries `__cr.` is left exactly as given — an
 * explicitly targeted credential is a deliberate choice, not something to
 * rewrite. A proxy with no username (an open or ip-authenticated gateway) is
 * passed through untouched for the same reason.
 */
export function proxyUrlFor(base: string | undefined, country: string): string | undefined {
  if (!base) return undefined;
  // Turkey never leaves through the proxy, except a Zara lookup on Vercel
  // (see ZARA_TR_EXIT) — owner 2026-10-29.
  const c = country.toLowerCase();
  if (c === "tr") return undefined;
  if (c === ZARA_TR_EXIT) country = "tr";
  let u: URL;
  try { u = new URL(base); } catch { return undefined; }
  if (!u.username || u.username.includes("__cr.")) return base;
  u.username = `${u.username}__cr.${country.toLowerCase()}`;
  return u.toString();
}

/**
 * The exit that never goes through the proxy, whatever is configured.
 *
 * Turkish shops are fetched direct — owner rule, "no proxy for Turkey, ever"
 * (docs/collector-unblock-playbook.md §4) — and so are hosts that answer any
 * datacenter anyway (Algolia), where the proxy only cost money.
 */
export const DIRECT = "direct";

/**
 * `exit` unless it is Turkey's, which becomes DIRECT. Zara and the itxrest
 * brands answer GitHub's runners with no proxy in Turkey (probe run
 * 40864254153, 2026-10-29) — the same egress the collector's own Turkish
 * sweeps use, so the reprice pass goes direct.
 */
export const directInTurkey = (exit: string): string => (exit === "tr" ? DIRECT : exit);

/**
 * The one Turkish exit allowed through the proxy: Zara product tracking on
 * Vercel. Akamai answers Vercel's fra1 egress 403 for Zara (measured on
 * production 2026-10-29), and the owner chose to keep the proxy for Zara only
 * (2026-10-29: "only for zara product track use proxy"). Every other Turkish
 * shop — the itxrest brands included — goes direct even where that fails.
 */
export const ZARA_TR_EXIT = "tr-zara";
export const zaraExit = (exit: string): string =>
  exit === "tr" && process.env.VERCEL ? ZARA_TR_EXIT : directInTurkey(exit);

/**
 * One agent per country, built once. A ProxyAgent per request leaks sockets in
 * a warm lambda, and the countries are a closed set.
 */
const agents = new Map<string, ProxyAgent | undefined>();
export function dispatcher(country: string): Dispatcher | undefined {
  if (country === DIRECT) return undefined;
  if (!agents.has(country)) {
    const url = proxyUrlFor(process.env.DATAIMPULSE_PROXY, country);
    agents.set(country, url ? new ProxyAgent(url) : undefined);
  }
  return agents.get(country);
}

/** True when a proxy is configured — useful for explaining a 403 to the caller. */
export function usingProxy(): boolean {
  return !!process.env.DATAIMPULSE_PROXY;
}

export const toMinor = (major: number) => Math.round(major * 100);

/**
 * The shop answered that the product no longer exists — Zara's 410, itxrest's
 * `_ERR_PRODUCT_NOT_FOUND`, Algolia's "ObjectID does not exist". Not a refusal:
 * asking again will not bring it back, so the reprice pass marks the tracked
 * row sold out instead of counting it "unreachable" on every run (2026-10-29:
 * 17 of 19 "unreachable" were products these shops had removed in July–October).
 */
export class ProductGone extends Error {
  constructor(host: string, status: number) {
    super(`${host} says the product is gone (HTTP ${status})`);
    this.name = "ProductGone";
  }
}

/** How a request left, for the refusal log: the proxy exit, or direct. */
export const egress = (country: string): string =>
  dispatcher(country) ? ` (via ${country} proxy)` : " (direct egress)";

/**
 * A miss and an upstream refusal are different failures and must not look the
 * same: "we do not stock this" is a dead end, "the brand would not answer us"
 * is worth retrying. The reason is logged rather than swallowed — this ran for
 * a full deploy returning a silent null before anyone could see why.
 *
 * `gone` recognises the shop's own "no such product" answer; a match throws
 * ProductGone (lookupLive still answers null, checkLive says "gone").
 */
export async function json<T>(
  url: string,
  headers: Record<string, string>,
  country: string,
  gone?: (status: number, body: string) => boolean,
): Promise<T | null> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      if (gone && gone(r.status, await r.text().catch(() => ""))) throw new ProductGone(host, r.status);
      console.warn(`live-lookup: ${host} refused with HTTP ${r.status}${egress(country)}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    if (err instanceof ProductGone) throw err;
    console.warn(`live-lookup: ${host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * GraphQL needs POST, which `json()` above cannot do. Same proxy, same timeout,
 * same rule about telling a refusal apart from a miss.
 */
export async function postJson<T>(url: string, body: unknown, country: string): Promise<T | null> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${host} refused with HTTP ${r.status}${egress(country)}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    console.warn(`live-lookup: ${host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

