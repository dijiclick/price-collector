import { ProxyAgent, type Dispatcher } from "undici";
import { proxyUrlFor } from "../../../lib/live-lookup";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let proxyAgent: ProxyAgent | undefined;
/**
 * Residential egress, pinned to a TURKISH exit.
 *
 * The country rides in the username (`user__cr.tr`) and DataImpulse's default
 * is the US — which is not merely suboptimal here, it fails: Sephora answers
 * 200 through a TR exit and 403 through the default one. Every shop the
 * collector reads is a Turkish storefront, so there is no case where another
 * exit is the right answer. Measured 2026-08-25.
 */
function getProxyAgent(): ProxyAgent | undefined {
  const url = proxyUrlFor(process.env.DATAIMPULSE_PROXY, "tr");
  if (!url) return undefined;
  if (!proxyAgent) proxyAgent = new ProxyAgent(url);
  return proxyAgent;
}

export interface FetchOpts {
  headers?: Record<string, string>;
  proxy?: boolean;
  method?: string;
  body?: string;
  retries?: number;
}

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
  const viaProxy = opts.proxy ? getProxyAgent() : undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const dispatcher: Dispatcher | undefined = attempt === 0 ? undefined : viaProxy;
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Accept-Language": "tr-TR,tr;q=0.9",
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
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "tr-TR,tr;q=0.9", ...opts.headers },
    // @ts-expect-error undici dispatcher
    dispatcher: opts.proxy ? getProxyAgent() : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
