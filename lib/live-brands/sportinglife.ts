/**
 * Sporting Life by url (`sportinglife.ca/en-CA/…/<slug>/<itemid>.html`). The
 * product page is server-rendered SiteGenesis: "Item No." carries the
 * collector's id (`data-itemid`, see packages/collector/src/brands/sportinglife.ts),
 * `#product-content .product-price` prints the regular and the sale price the
 * same way the sale grid does, and the JSON-LD offers carry stock. Cloudflare
 * refuses Turkish/German IPs; US egress is let through.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, usingProxy } from "../live-http";

const SITE = "https://www.sportinglife.ca";

export function sportinglifePathFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)sportinglife\.ca$/i.test(u.hostname)) return null;
  return /^\/(?:en-CA|fr-CA)\/.+\/[A-Za-z0-9_-]+\.html$/i.test(u.pathname) ? u.pathname : null;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();

const dollars = (s: string | undefined): number | null => {
  const m = decode(String(s ?? "")).match(/^\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * 100 + Number(m[2] ?? 0);
  return n > 0 ? n : null;
};

/** Map a product page. Pure. */
export function mapSportingLifePage(html: string, path: string): LiveProduct | null {
  const id = html.match(/<span data-masterid="[^"]*">\s*([^<\s]+)\s*<\/span>/)?.[1];
  const title = html.match(/<span class="product-name" itemprop="name">([^<]+)<\/span>/)?.[1];
  const make = html.match(/<span class="product-brand" itemprop="brand">([^<]+)<\/span>/)?.[1];
  if (!id || !title) return null;
  const at = html.indexOf('id="product-content"');
  const block = at >= 0 ? html.slice(at) : html;
  const priceDiv = block.match(/<div class="product-price">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const regular = dollars(priceDiv.match(/class="price-standard"[^>]*>([^<]*)</)?.[1]);
  const sale = dollars(priceDiv.match(/class="price-sales[^"]*"[^>]*>([^<]*)</)?.[1]);
  const price = sale ?? regular;
  if (price == null) return null;
  const name = decode(title);
  const brandName = make ? decode(make) : "";
  const img = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const offers = [...html.matchAll(/"availability":\s*"https:\/\/schema\.org\/(\w+)"/g)].map((m) => m[1]);
  return {
    brand: "sportinglife",
    externalId: id,
    name: brandName && !name.toLowerCase().startsWith(brandName.toLowerCase()) ? `${brandName} ${name}` : name,
    url: `${SITE}${path}`,
    imageUrl: img ? decode(img) : null,
    price,
    listPrice: regular != null && regular > price ? regular : null,
    inStock: offers.length ? offers.some((a) => a === "InStock" || a === "LimitedAvailability") : true,
    category: null,
    type: null,
    gender: /\/(?:en-CA|fr-CA)\/(?:shoes\/)?women\//i.test(path) ? "kadin" : /\/(?:en-CA|fr-CA)\/(?:shoes\/)?men\//i.test(path) ? "erkek" : null,
    colorName: null,
    country: "CA",
    currency: "CAD",
  };
}

export async function sportinglifeUrl(url: string): Promise<LiveProduct | null> {
  const path = sportinglifePathFromUrl(url);
  if (!path) return null;
  const country = countryFor("sportinglife", "CA");
  try {
    const r = await fetch(`${SITE}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-CA,en;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.sportinglife.ca refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    return mapSportingLifePage(await r.text(), path);
  } catch (err) {
    console.warn(`live-lookup: www.sportinglife.ca unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
