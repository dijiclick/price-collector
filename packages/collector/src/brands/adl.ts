import type { ProductRecord } from "../types";
import { listOccCatalogue, mapOccProduct, type OccSite } from "./_sapocc";

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
 *
 * FULL CATALOGUE since 2026-10-19: ADL has no single root category, but here
 * the plain `:new-coming` query (no category) does match the whole shop —
 * 2,314 items on 2026-10-19, the Outlet's 1,228 among them — so it is walked
 * at 1,000 a page (3 requests; _sapocc.ts listOccCatalogue). Unreduced items
 * are full-price rows (`listPrice` null).
 */
export const SITE: OccSite = {
  brand: "adl",
  api: "https://api.adl.com.tr/occ/v2/adl",
  web: "https://www.adl.com.tr",
  saleCategory: "0004",
  catalogueQuery: ":new-coming",
};

export const brand = SITE.brand;

/** Map one search hit. Pure; null unless the item is reduced, or `fullPrice` asks for every item. */
export function mapAdl(p: any, opts: { fullPrice?: boolean } = {}): ProductRecord | null {
  const strike = p?.firstStrikePrice ?? p?.originalPrice;
  const r = mapOccProduct(SITE, { ...p, firstStrikePrice: strike }, "kadin", opts);
  if (!r) return null;
  const crumbs: any[] = Array.isArray(p.breadcrumbs) ? p.breadcrumbs : [];
  const leaf = [...crumbs].reverse().find((b) => b?.categoryCode && typeof b.name === "string" && b.name.trim());
  const name = leaf ? String(leaf.name).replace(/^outlet\s+/i, "").trim() : "";
  if (name && !/^kategoriler$/i.test(name)) r.category = name;
  return r;
}

export async function listProducts(): Promise<ProductRecord[]> {
  return listOccCatalogue(SITE, {
    map: (p) => mapAdl(p, { fullPrice: true }),
    maxProducts: Number(process.env.ADL_MAX_PRODUCTS ?? 15_000),
    maxRequests: Number(process.env.ADL_MAX_REQUESTS ?? 30),
  });
}
