/**
 * Boozt — the Nordics' biggest multi-brand fashion e-tailer (boozt.com/no),
 * Norway, 2026-10-11.
 *
 * A listing URL answers with its listing model as JSON when the request
 * carries `X-Requested-With: XMLHttpRequest` (the site's own client paging):
 * `listingData[].data` holds brand, name, product url, images, the in-stock
 * size labels and `prices`. Plain GET, no key, no cookie, no proxy.
 *
 * RATE LIMIT (measured from GitHub runners, 2026-10-11): Cloudflare lets ~5
 * listing requests through in a burst, then answers 429 until ~30 s have
 * passed. So pages go in bursts of BURST with a ~32 s rest between bursts; a
 * refused page waits out the window and is retried once, otherwise skipped —
 * never fatal unless nothing at all came back.
 *
 * PRICE MODEL — read before trusting the numbers. Boozt sells its markdowns
 * as opt-in "Deals": `prices.optin` is the reduced price ("2999 kr med Deal"),
 * which the shopper gets by tapping "Aktiver" on the product (no login, no
 * code); `prices.sale` is the classic markdown and is rarely set. The site's
 * own "mdv" price view shows the deal as red price + struck-through base, and
 * that is what this maps: price = min(sale, optin), listPrice = base. On
 * 2026-10-11 every product in the deals section was an opt-in deal.
 *
 * Only the colour the card shows is emitted (its own price + sizes); other
 * colours of the same card often are NOT reduced. The card's `sizes` are the
 * sizes that can be bought, so each is in stock ("last"/"few" → low).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.boozt.com";

/** Deals sections per market and how many pages of each to read (~100 cards a page). */
export const BOOZT_MARKETS: Partial<Record<CountryCode, { section: string; gender: ProductRecord["gender"]; pages: number }[]>> = {
  NO: [
    { section: "/no/no/kvinner/tilbud", gender: "kadin", pages: 9 },
    { section: "/no/no/menn/tilbud", gender: "erkek", pages: 3 },
  ],
};

const BURST = 5;
const PAUSE_MS = Number(process.env.BOOZT_PAUSE_MS ?? 700);
const WINDOW_MS = Number(process.env.BOOZT_WINDOW_MS ?? 32000);
const MAX_REQUESTS = 18;
/** Hard stop for new requests, so one brand never holds the sweep past ~2.5 min. */
const DEADLINE_MS = Number(process.env.BOOZT_DEADLINE_MS ?? 140000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

/** Current (deal or sale) price and base price, or null when not reduced. */
export function booztPrices(prices: any): { price: number; list: number } | null {
  const base = num(prices?.base?.price);
  const cands = [num(prices?.sale?.price), num(prices?.optin?.price)].filter((n) => Number.isFinite(n) && n > 0);
  if (!Number.isFinite(base) || !cands.length) return null;
  const price = Math.min(...cands);
  return base > price ? { price, list: base } : null;
}

/** "WOOL BLEND JACKET - Ulljakker" → "Ulljakker". */
export function booztCategory(displayName: unknown, productName: unknown): string | null {
  const d = String(displayName ?? "");
  const p = String(productName ?? "");
  const rest = p && d.startsWith(p) ? d.slice(p.length).replace(/^\s*-\s*/, "") : (d.split(" - ").slice(1).join(" - "));
  return rest.trim() || null;
}

/** Map one listing card (`listingData[].data`). Pure. Returns only reduced rows. */
export function mapBoozt(p: any, country: CountryCode = "NO", gender: ProductRecord["gender"] = null): ProductRecord | null {
  const id = p?.id != null ? String(p.id) : "";
  const vid = p?.variant_id != null ? String(p.variant_id) : "";
  const url = typeof p?.product_url === "string" ? p.product_url : null;
  const productName = String(p?.product_name ?? "").trim();
  if (!id || !url || !productName) return null;
  const pr = booztPrices(p?.prices);
  if (!pr) return null;
  const brand = String(p?.brand_name ?? "").trim();
  const imgs = (Array.isArray(p?.media) ? p.media : [])
    .filter((m: any) => m?.type === "image" || m?.type === "alternative_image")
    .map((m: any) => m?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const low = p?.stock_status === "last" || p?.stock_status === "few";
  const sizes = (Array.isArray(p?.sizes) ? p.sizes : [])
    .filter((s: unknown) => typeof s === "string" && s.trim())
    .map((s: string) => ({ label: s.trim(), availability: low ? ("low_on_stock" as const) : ("in_stock" as const) }));
  const color = typeof p?.color_name === "string" && p.color_name.trim() ? p.color_name.trim() : null;
  return {
    brand: "boozt",
    country,
    externalId: vid ? `${id}-${vid}` : id,
    name: brand ? `${brand} ${productName}` : productName,
    url: /^https?:\/\//.test(url) ? url : `${ORIGIN}${url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pr.price),
    listPrice: toMinor(pr.list),
    currency: COUNTRIES[country].currency,
    inStock: p?.in_stock !== false && (sizes.length > 0 || !Array.isArray(p?.sizes)),
    category: booztCategory(p?.display_name, productName),
    gender,
    variants: sizes.length ? { colors: color ? [color] : [], sizes } : null,
    colorName: color,
    groupKey: null,
  };
}

export const cardsOf = (d: any): any[] =>
  (Array.isArray(d?.listingData) ? d.listingData : []).filter((x: any) => x?.type === "product").map((x: any) => x.data);

const HEADERS = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };

export async function listBoozt(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  const sections = BOOZT_MARKETS[country];
  if (!sections) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let inBurst = 0;
  const t0 = Date.now();
  const get = async (url: string): Promise<any | null> => {
    for (let attempt = 0; attempt < 2 && requests < MAX_REQUESTS; attempt++) {
      if (Date.now() - t0 + (inBurst >= BURST ? WINDOW_MS : 0) > DEADLINE_MS) return null;
      if (inBurst >= BURST) {
        await sleep(WINDOW_MS);
        inBurst = 0;
      } else if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      inBurst++;
      try {
        return await getJson<any>(url, { headers: HEADERS, country, retries: 0 });
      } catch {
        inBurst = BURST; // refused: wait the window out before the retry
      }
    }
    return null;
  };

  for (const s of sections) {
    for (let page = 1; page <= s.pages && requests < MAX_REQUESTS && byId.size < cap * 1.2; page++) {
      const d = await get(`${ORIGIN}${s.section}?page=${page}`);
      if (d == null) continue;
      const cards = cardsOf(d);
      if (!cards.length) break;
      for (const c of cards) {
        const r = mapBoozt(c, country, s.gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const pageCount = Number(d?.paging?.pageCount ?? Infinity);
      if (page >= pageCount) break;
    }
  }
  if (byId.size === 0 && requests > 0) throw new Error(`boozt/${country}: no deals (${requests} requests refused or empty)`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
