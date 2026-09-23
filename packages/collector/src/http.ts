import { ProxyAgent, type Dispatcher } from "undici";
import { proxyUrlFor } from "../../../lib/live-lookup";
import { COUNTRIES, DEFAULT_COUNTRY, type CountryCode } from "../../../lib/countries";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Residential egress, leaving from the SHOP'S OWN country.
 *
 * The country rides in the username (`user__cr.tr`) and DataImpulse's default
 * is the US — which is not merely suboptimal, it fails: Sephora answers 200
 * through a TR exit and 403 through the default one (measured 2026-08-25). A
 * British storefront answered from a Turkish IP is the same hazard in the other
 * direction: the request most likely to be challenged, priced differently, or
 * served another locale.
 *
 * One agent per country, built once — a ProxyAgent per request leaks sockets,
 * and the country list is a closed set.
 */
const proxyAgents = new Map<string, ProxyAgent | undefined>();
function getProxyAgent(country: CountryCode): ProxyAgent | undefined {
  const exit = COUNTRIES[country].proxyExit;
  if (!proxyAgents.has(exit)) {
    const url = proxyUrlFor(process.env.DATAIMPULSE_PROXY, exit);
    proxyAgents.set(exit, url ? new ProxyAgent(url) : undefined);
  }
  return proxyAgents.get(exit);
}

export interface FetchOpts {
  headers?: Record<string, string>;
  proxy?: boolean;
  method?: string;
  body?: string;
  retries?: number;
  /**
   * Which market this request is for. Drives the proxy exit and the default
   * `Accept-Language`. Absent means Turkey, which is what every adapter is
   * asking for until its own task parameterises it.
   */
  country?: CountryCode;
}

/**
 * The header a storefront reads to pick a language, per market.
 *
 * Turkish for Turkey, and English elsewhere in wave 1 — the Gulf and British
 * storefronts serve English, and it is also the language `lib/productTypes.ts`
 * can classify. Adapters that need a specific locale still pass their own
 * header; this is only the default.
 */
const acceptLanguage = (c: CountryCode): string =>
  c === "TR" ? "tr-TR,tr;q=0.9" : `en-${c},en;q=0.9`;

/**
 * GET/POST JSON with a browser UA, gzip, retry, and the residential proxy as a
 * FALLBACK.
 *
 * `proxy: true` means "this host sometimes blocks our egress", not "always go
 * through the proxy". Direct is tried first and the proxy is used only after a
 * direct attempt fails, because residential bandwidth is metered and paid while
 * datacenter egress is free. Watsons is the case that proves it: it answers
 * GitHub's runners perfectly well most days, and routing it through the proxy
 * unconditionally made it slower, cost real money per sweep, and then broke it.
 *
 * The first attempt is direct; every later attempt uses the proxy when one is
 * configured. With no proxy configured this degrades to the old plain retry.
 */
export async function getJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const country = opts.country ?? DEFAULT_COUNTRY;
  const viaProxy = opts.proxy ? getProxyAgent(country) : undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const dispatcher: Dispatcher | undefined = attempt === 0 ? undefined : viaProxy;
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Accept-Language": acceptLanguage(country),
          ...opts.headers,
        },
        body: opts.body,
        // @ts-expect-error undici dispatcher is accepted by Node's fetch
        dispatcher,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** GET raw text (for HTML seeding, e.g. Mango). */
export async function getText(url: string, opts: FetchOpts = {}): Promise<string> {
  const country = opts.country ?? DEFAULT_COUNTRY;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": acceptLanguage(country), ...opts.headers },
    // @ts-expect-error undici dispatcher
    dispatcher: opts.proxy ? getProxyAgent(country) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
