/**
 * 6pm (6pm.com, US only) — Zappos' off-price sister store, multi-brand.
 *
 * 6pm's React app calls the same search backend as Zappos,
 * `prod.olympus.zappos.com/Search/zso/…`, with `siteId=2&subsiteId=12` (read
 * from 6pm.com's own page config, `api.calypso`, 2026-10-21). The result shape
 * is identical, so the Zappos mapper is reused and the row re-labelled.
 *
 * `price` is 6pm's price and `originalPrice` the price the item carried at full
 * price (MSRP), struck through on 6pm.com — the same off-price model as Nordstrom
 * Rack. Only rows with original > price are kept. `onHand` gives stock, and shoes
 * carry their in-stock sizes (see zappos.ts). `maker` is the real brand.
 *
 * Walks: women's shoes / clothing / bags, men's shoes / clothing, best sellers
 * first.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { BAGS, CLOTHING, SHOES, decode, mapZappos, zso } from "./zappos";

export const brand = "sixpm";

const API = "https://prod.olympus.zappos.com/Search/zso";
const SITE = "https://www.6pm.com";
const CAP = 1500;
const PAUSE_MS = 600;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};
const INCLUDES = [
  "onHand", "txAttrFacet_Gender", "productType", "categoryFacet", "subCategoryFacet",
  "styleColor", "imageMap", "onSale", "productSeoUrl", "hc_women_size", "hc_men_size",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SixWalk {
  label: string;
  gender: 1 | 2;
  zc1: number;
  limit: number;
  pages: number;
}

export const SIX_WALKS: SixWalk[] = [
  { label: "women shoes", gender: 1, zc1: SHOES, limit: 300, pages: 1 },
  { label: "women clothing", gender: 1, zc1: CLOTHING, limit: 300, pages: 1 },
  { label: "women bags", gender: 1, zc1: BAGS, limit: 200, pages: 1 },
  { label: "men shoes", gender: 2, zc1: SHOES, limit: 300, pages: 1 },
  { label: "men clothing", gender: 2, zc1: CLOTHING, limit: 300, pages: 1 },
];

export function sixSearchUrl(w: SixWalk, page: number): string {
  const q = new URLSearchParams({
    limit: String(w.limit),
    page: String(page),
    includes: JSON.stringify(INCLUDES),
    s: "recentSalesStyle/desc",
    siteId: "2",
    subsiteId: "12",
  });
  return `${API}/sale/${zso({ gender: w.gender, zc1: w.zc1 })}.zso?${q}`;
}

/** Map one 6pm search result. Pure; null unless genuinely reduced. */
export function mapSixPm(r: any, w: Pick<SixWalk, "gender">): ProductRecord | null {
  const z = mapZappos(r, w);
  if (!z) return null;
  const path = String(r?.productSeoUrl || r?.productUrl || "").replace(/^https?:\/\/[^/]+/, "");
  const make = decode(String(r?.brandName ?? "")).replace(/[®™]/g, "").trim();
  return {
    ...z,
    brand,
    url: SITE + path,
    maker: make || null,
    groupKey: `sixpm-${r.productId}`,
  };
}

export async function listSixPm(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const w of SIX_WALKS) {
    for (let page = 1; page <= w.pages; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(sixSearchUrl(w, page), { country, retries: 1, headers: HEADERS, timeoutMs: 45_000 });
      const items: any[] = Array.isArray(data?.results) ? data.results : [];
      if (items.length === 0 && page === 1) throw new Error(`sixpm: ${w.label}: no results (API changed or refused)`);
      for (const it of items) {
        const r = mapSixPm(it, w);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (items.length < w.limit) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listSixPm;
