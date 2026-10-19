/**
 * Zen Pırlanta (www.zenpirlanta.com, Turkish diamond jeweller; a custom PHP
 * storefront) through the product API of its on-site shopping assistant
 * (2026-10-18).
 *
 * THE SITE IS WALLED. Cloudflare answers every path with a JS challenge
 * (`cf-mitigated: challenge`, 403) to a plain client, from a Turkish home line
 * as much as from a GitHub runner (probe run 39127592961); our Hetzner box is
 * geo-redirected to zen-diamond.de (EUR). Its Insider feed (partner
 * `zenpirlantatr`) is empty for every strategy, and its PrimeWidgets account is
 * suspended.
 *
 * The "ZenBot" assistant (widget at ecommerce-zen-widget.web.app, loaded on
 * every page) lists products from a Cloud Run API outside Cloudflare. Its
 * product list is a plain JSON POST — the call behind "Daha Fazla Ürün Göster",
 * no chat, no LLM, no key — and it answers a runner with 200 (same probe run):
 *
 *   POST https://ecommerce-api-xgkluach6a-ew.a.run.app/api/chat/products
 *   {"filters":{"discount_rate":{"min":1}},"skip":N,"limit":50,…}
 *
 * `filters` is a typed model (an unknown key is ignored, a wrong type answers
 * 400 naming the type); `discount_rate`, `price`, `weight`, `total_carat` and
 * `gold_karat` are RangeFilters ({min,max}). `limit` is capped at 50; `skip`
 * pages. The discounted set is 105 products in 3 requests (2026-10-18).
 *
 * FULL CATALOGUE (2026-10-19): with `filters: {}` the same route lists every
 * product it knows — 4,653 in 94 requests, ~55 s, no duplicate across pages
 * (the order is stable), and every one of the 105 discounted rows among them.
 * So the walk reads it all: reduced rows keep their rebuilt strike price, the
 * rest are full-price rows (`listPrice` null).
 *
 * PRICES. `price` is what the product page charges. The API's `originalPrice`
 * is always 0; the strike price the page prints is `price` grossed up by
 * `discountRate`, which the API ROUNDS to a whole percent: the page's
 * "Net İndirim -%26 42.990 TL 31.990 TL" arrives as price 31990, rate 26. So
 * `listPrice` = price / (1 − rate/100), rounded to 10 TL, is within half a
 * percentage point of the page's (43.230 vs 42.990 there; 89.790 exact on a
 * flat 10%). The percent a shopper sees is the page's own.
 *
 * Stock: the API lists only buyable products (`stock` is never 0 in a 4,000-row
 * sample), so every row is in stock. Rings have sizes on the page without
 * per-size stock in the API, so `variants` is null.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "zenpirlanta";
export const SITE = "https://www.zenpirlanta.com";
export const ENDPOINT = "https://ecommerce-api-xgkluach6a-ew.a.run.app/api/chat/products";
export const PAGE_SIZE = 50; // the API's cap

/** 94 pages today; room for the catalogue to double. */
const MAX_PAGES = Number(process.env.ZENPIRLANTA_MAX_PAGES ?? 200);
const CAP = Number(process.env.ZENPIRLANTA_MAX_PRODUCTS ?? 10_000);
/** Every product, not only the discounted range. */
export const FILTERS: Record<string, unknown> = {};
const PAUSE_MS = Number(process.env.ZENPIRLANTA_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ZEN_HEADERS = { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` };

export function zenBody(filters: Record<string, unknown>, skip: number, limit = PAGE_SIZE): string {
  return JSON.stringify({ filters, skip, limit, conversationId: "", is_visual_search: false });
}

/** The strike price from a whole-percent rate, rounded to 10 TL; null when not reduced. */
export function zenListPrice(price: number, rate: number, original?: number): number | null {
  if (Number.isFinite(original) && (original as number) > price) return original as number;
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 90) return null;
  return Math.round(price / (1 - rate / 100) / 10) * 10;
}

export function zenGender(category: string, sub: string, name: string): ProductRecord["gender"] {
  const s = [category, sub, name].join(" | ").toLocaleLowerCase("tr");
  if (/çocuk|bebek/.test(s)) return "cocuk";
  if (/erkek/.test(s)) return "erkek";
  if (/kadın|bayan/.test(s)) return "kadin";
  return null;
}

/** Map one API row. Pure; null for rows without a usable id, url or price. */
export function mapZen(p: any): ProductRecord | null {
  const price = Number(p?.price);
  const id = p?.productCode;
  const url = typeof p?.url === "string" ? p.url.split("?")[0] : "";
  if (!id || !p?.title || !url.startsWith(SITE) || !Number.isFinite(price) || price <= 0) return null;
  const list = zenListPrice(price, Number(p.discountRate), Number(p.originalPrice));
  const img = typeof p.imageUrl === "string" && /^https?:\/\//.test(p.imageUrl) ? p.imageUrl : null;
  const category = String(p.category ?? "").trim();
  const sub = String(p.subCategory ?? "").trim();
  return {
    brand,
    country: "TR",
    externalId: String(id),
    name: String(p.title).trim(),
    url,
    imageUrl: img,
    images: img ? [img] : null,
    price: toMinor(price),
    listPrice: list != null ? toMinor(list) : null,
    currency: "TRY",
    inStock: p.stock == null || Number(p.stock) > 0,
    category: sub || category || null,
    gender: zenGender(category, sub, String(p.title)),
    variants: null,
    colorName: typeof p.color === "string" && p.color.trim() ? p.color.trim() : null,
  };
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`zenpirlanta: more than ${MAX_PAGES} pages — raise ZENPIRLANTA_MAX_PAGES`);
    if (page > 0) await sleep(PAUSE_MS);
    const rows = await getJson<any[]>(ENDPOINT, {
      method: "POST",
      body: zenBody(FILTERS, page * PAGE_SIZE),
      headers: ZEN_HEADERS,
      retries: 2,
    }).catch(() => null);
    if (!Array.isArray(rows)) {
      if (page === 0) throw new Error("zenpirlanta: assistant product API refused");
      // A walk cut short is a partial catalogue; failing keeps the delist sweep off it.
      throw new Error(`zenpirlanta: product API failed on page ${page + 1}`);
    }
    let fresh = 0;
    for (const p of rows) {
      const r = mapZen(p);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      fresh++;
    }
    if (rows.length < PAGE_SIZE || fresh === 0) break;
  }
  const all = [...byId.values()];
  // A cap that cut rows would let the delist sweep mark them sold out: refuse instead.
  if (all.length > CAP) throw new Error(`zenpirlanta: ${all.length} products, over the cap of ${CAP}`);
  return [...all.filter((r) => r.listPrice != null), ...all.filter((r) => r.listPrice == null)];
}
