import type { ProductRecord } from "../types";
import { listOccCatalogue, type OccSite } from "./_sapocc";

// Vakkorama — same SAP Commerce OCC v2 backend as Vakko, site `rsite` on its own
// API host. Multi-brand. FULL CATALOGUE since 2026-10-19: the root category `2`
// (16,711 items on 2026-10-19; the Outlet tree 203 is 8,189 of them) is walked
// at 1,000 a page, ~40 requests; see _sapocc.ts listOccCatalogue.
export const SITE: OccSite = {
  brand: "vakkorama",
  api: "https://api.vakkorama.com.tr/occ/v2/rsite",
  web: "https://www.vakkorama.com.tr",
  saleCategory: "203",
  catalogueQuery: ":new-coming:allCategories:2",
};

export const brand = SITE.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listOccCatalogue(SITE, {
    maxProducts: Number(process.env.VAKKORAMA_MAX_PRODUCTS ?? 50_000),
    maxRequests: Number(process.env.VAKKORAMA_MAX_REQUESTS ?? 150),
  });
}
