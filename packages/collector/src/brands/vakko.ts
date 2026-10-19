import type { ProductRecord } from "../types";
import { listOccCatalogue, type OccSite } from "./_sapocc";

// Vakko — SAP Commerce OCC v2, site `vsite`. FULL CATALOGUE since 2026-10-19:
// the root category `3` (20,846 items on 2026-10-19 — the Outlet tree 312 is
// 12,098 of them, ~95% reduced) is walked at 1,000 a page, ~45 requests; see
// _sapocc.ts listOccCatalogue. Reduced items keep their strike price, the rest
// are full-price rows.
export const SITE: OccSite = {
  brand: "vakko",
  api: "https://api.vakko.com/occ/v2/vsite",
  web: "https://www.vakko.com",
  saleCategory: "312",
  catalogueQuery: ":new-coming:allCategories:3",
};

export const brand = SITE.brand;

/** TR only: Vakko's EUR sites (vsite_eu/vsite_gr) are not collected. */
export async function listProducts(): Promise<ProductRecord[]> {
  return listOccCatalogue(SITE, {
    maxProducts: Number(process.env.VAKKO_MAX_PRODUCTS ?? 60_000),
    maxRequests: Number(process.env.VAKKO_MAX_REQUESTS ?? 150),
  });
}
