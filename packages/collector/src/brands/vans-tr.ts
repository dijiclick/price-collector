import type { ProductRecord } from "../types";
import { listRnd, rndLimitsFromEnv, type RndShop } from "./_rnd";

/**
 * Vans Turkey — www.vans.com.tr, an RND Commerce storefront (see _rnd.ts).
 * Same brand slug as the Australian adapter (vans.ts, Magento GraphQL) — the
 * registry picks this one for Turkey with `byMarket`.
 *
 * `/tum-outlet` is the sale (814 products on 2026-10-18, every one reduced);
 * the department trees carried no strike price at all (/kadin, /erkek page 1:
 * 0 of 96). ~17 pages. The cards' GA4 item gives section, type and colour.
 */
export const SHOP: RndShop = {
  brand: "vans",
  site: "https://www.vans.com.tr",
  listings: [{ path: "/tum-outlet" }],
  detailPath: (id) => `/quicklook?productdescriptionid=${id}`,
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listRnd(SHOP, rndLimitsFromEnv("VANS_TR", { maxProducts: 1500, maxPages: 30, detailLimit: 250, budgetMs: 140_000 }));
}
