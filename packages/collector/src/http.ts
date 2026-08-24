import { ProxyAgent, type Dispatcher } from "undici";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let proxyAgent: ProxyAgent | undefined;
function getProxyAgent(): ProxyAgent | undefined {
  const url = process.env.DATAIMPULSE_PROXY;
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

/** GET/POST JSON with a browser UA, gzip, retry, and optional residential proxy. */
export async function getJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const dispatcher: Dispatcher | undefined = opts.proxy ? getProxyAgent() : undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
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
