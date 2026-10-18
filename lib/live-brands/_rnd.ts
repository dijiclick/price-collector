/**
 * Single-product lookup for RND Commerce storefronts — Levi's TR
 * (levis.com.tr), Vans TR, Timberland TR. The collector is
 * packages/collector/src/brands/_rnd.ts; this reads one product page.
 *
 * The id is the number that ends the product url (`…-ayakkabi_124650`), the
 * same `data-id` the collector stores. The page carries the shopper-facing
 * `old-price`/`new-price` pair, `og:title`/`og:image`, every size with its
 * stock count, and (Vans, Timberland) the GA4 item with section, type and
 * colour; Levi's has its legacy dataLayer push instead.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor, usingProxy } from "../live-http";

export interface RndLiveShop {
  brand: string;
  /** Origin, e.g. `https://www.vans.com.tr`. */
  site: string;
  /** Hostname without `www.`, guards against other shops' urls. */
  host: string;
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

function genderOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = fold(text);
  if (/cocuk|bebek|\bkids?\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

function amount(s: string | undefined): number | null {
  const m = String(s ?? "").match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  const n = m ? Number(`${m[1].replace(/\./g, "")}.${m[2]}`) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
const span = (html: string, cls: string) =>
  amount(html.match(new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>\\s*([\\d.]+,\\d{2})\\s*TL`))?.[1]);

export function rndLiveId(shop: RndLiveShop, url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().replace(/^www\./, "").endsWith(shop.host)) return null;
  return u.pathname.match(/_(\d+)\/?$/)?.[1] ?? null;
}

/** The GA4 item for THIS product (its url ends in `_<id>`), else the page's first. */
function eventItem(html: string, id: string): any | null {
  let first: any = null;
  for (const m of html.matchAll(/data-event-data="([^"]*)"/g)) {
    try {
      const it = JSON.parse(decode(m[1]))?.items?.[0];
      if (!it) continue;
      if (String(it.product_url ?? "").endsWith(`_${id}`)) return it;
      first ??= it;
    } catch {
      /* not JSON */
    }
  }
  return first;
}

/** Sizes with a stock count; Levi's length ("drop") list skipped. */
function sizesInStock(html: string): boolean[] {
  const seen = new Set<string>();
  const out: boolean[] = [];
  for (const m of html.matchAll(/<(?:li|a)\b[^>]*>/g)) {
    const tag = m[0];
    if (/data-js="[^"]*drop/.test(tag)) continue;
    const stock = tag.match(/\bdata-(?:stock|count-alert)="(-?\d+)"/)?.[1];
    const label = tag.match(/\btitle="([^"]*)"/)?.[1] ?? tag.match(/\bdata-key="([^"]*)"/)?.[1];
    if (stock == null || !label || seen.has(label)) continue;
    seen.add(label);
    out.push(Number(stock) > 0);
  }
  return out;
}

const layer = (html: string, key: string) => {
  const v = html.match(new RegExp(`['"]${key}['"]\\s*:\\s*"([^"]*)"`))?.[1];
  return v && v.trim() ? decode(v.trim()) : null;
};

/** Map one product page. Pure. */
export function mapRndPage(shop: RndLiveShop, html: string, id: string, path: string): LiveProduct | null {
  const ev = eventItem(html, id);
  const og = (p: string) => html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`))?.[1] ?? null;
  const name = decode(String(ev?.item_name ?? og("title") ?? "")).replace(/\s+/g, " ").trim();
  // The page's own spans first (what the shopper sees), the GA4 pair otherwise.
  const spanNow = span(html, "new-?price") ?? span(html, "one-price");
  const now = spanNow ?? (Number(ev?.price) > 0 ? Number(ev.price) : null);
  const was = spanNow != null ? span(html, "old-?price") : Number(ev?.first_price) > 0 ? Number(ev.first_price) : null;
  if (!name || now == null) return null;
  const sizes = sizesInStock(html);
  const section = typeof ev?.item_category === "string" ? ev.item_category : "";
  const realSection = genderOf(section) != null || /^uni/i.test(fold(section).trim());
  const type = realSection && typeof ev?.item_category2 === "string" && ev.item_category2.trim() ? ev.item_category2.trim() : null;
  const colour = (typeof ev?.item_variant === "string" && ev.item_variant.trim()) || layer(html, "variant");
  return {
    brand: shop.brand,
    externalId: id,
    name,
    url: `${shop.site}${path}`,
    imageUrl: og("image"),
    price: toMinor(now),
    listPrice: was != null && was - now > 0.005 ? toMinor(was) : null,
    inStock: sizes.length ? sizes.some(Boolean) : ev ? Number(ev.stock ?? 0) > 0 : true,
    category: type ?? layer(html, "category"),
    type: null,
    gender: genderOf(section) ?? genderOf(layer(html, "product_departman")) ?? genderOf(name),
    colorName: colour || null,
    country: "TR",
    currency: "TRY",
  };
}

export async function rndUrl(shop: RndLiveShop, url: string): Promise<LiveProduct | null> {
  const id = rndLiveId(shop, url);
  if (!id) return null;
  const path = new URL(url).pathname.replace(/\/$/, "");
  const country = countryFor(shop.brand);
  try {
    const r = await fetch(`${shop.site}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${shop.host} refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    return mapRndPage(shop, await r.text(), id, path);
  } catch (err) {
    console.warn(`live-lookup: ${shop.host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
