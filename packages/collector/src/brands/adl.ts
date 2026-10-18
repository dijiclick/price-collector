import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { mapOccProduct, searchUrl, type OccSite } from "./_sapocc";

/**
 * ADL TR (women's wear) — SAP Commerce OCC v2, site `adl`, the same platform
 * and public API as Vakko (_sapocc.ts). Built 2026-10-18.
 *
 * `api.adl.com.tr/occ/v2/adl/products/search?query=:new-coming:allCategories:0004`
 * pages the Outlet tree (category 0004, 1,195 items, 100 per page). No auth;
 * answers a GitHub runner with 200 (probe run 39124308073).
 *
 * PRICES. Unlike Vakko, ADL carries no `firstStrikePrice`: the strike price is
 * `originalPrice` (3.999,95 → 2.999,95, `discountRate: "%25"`). The hit is
 * passed to the shared mapper with `originalPrice` as its strike, so the rest
 * (per-size stock from `sizeDetail`, EANs, gallery, groupKey) is Vakko's code.
 * `promotionSimulation` ("Sepette Ek %20 İndirim! 2.399,96 TL") is a basket
 * campaign, not the shelf price, and is ignored.
 *
 * CATEGORY. The shared mapper takes the last category, which on ADL is a
 * campaign bucket ("Büyük Yaz İndirimi Elbise"); the product type is the last
 * real breadcrumb ("Kategoriler > Elbise > Günlük Elbise").
 */
export const SITE: OccSite = {
  brand: "adl",
  api: "https://api.adl.com.tr/occ/v2/adl",
  web: "https://www.adl.com.tr",
  saleCategory: "0004",
};

export const brand = SITE.brand;

const MAX_PRODUCTS = Number(process.env.ADL_MAX_PRODUCTS ?? 2000);
const MAX_PAGES = Number(process.env.ADL_MAX_PAGES ?? 25);
const PAUSE_MS = Number(process.env.ADL_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Map one search hit. Pure; null unless the item is reduced. */
export function mapAdl(p: any): ProductRecord | null {
  const strike = p?.firstStrikePrice ?? p?.originalPrice;
  const r = mapOccProduct(SITE, { ...p, firstStrikePrice: strike }, "kadin");
  if (!r) return null;
  const crumbs: any[] = Array.isArray(p.breadcrumbs) ? p.breadcrumbs : [];
  const leaf = [...crumbs].reverse().find((b) => b?.categoryCode && typeof b.name === "string" && b.name.trim());
  const name = leaf ? String(leaf.name).replace(/^outlet\s+/i, "").trim() : "";
  if (name && !/^kategoriler$/i.test(name)) r.category = name;
  return r;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const query = `:new-coming:allCategories:${SITE.saleCategory}`;
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let page = 0; page < Math.min(pages, MAX_PAGES) && byId.size < MAX_PRODUCTS; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(searchUrl(SITE, query, page), { retries: 1 }).catch((e) => {
      if (page === 0) throw e;
      return null;
    });
    if (!data) break;
    pages = Number(data?.pagination?.totalPages) || 0;
    for (const p of data?.products ?? []) {
      const r = mapAdl(p);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
