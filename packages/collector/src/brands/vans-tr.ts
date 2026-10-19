import type { ProductRecord } from "../types";
import { listRndCatalogue, rndLimitsFromEnv, type RndShop } from "./_rnd";

/**
 * Vans Turkey — www.vans.com.tr, an RND Commerce storefront (see _rnd.ts).
 * Same brand slug as the Australian adapter (vans.ts, Magento GraphQL) — the
 * registry picks this one for Turkey with `byMarket`.
 *
 * `/tum-outlet` is the sale (814 products on 2026-10-18, every one reduced);
 * the department trees carried no strike price at all (/kadin, /erkek page 1:
 * 0 of 96). ~17 pages. The cards' GA4 item gives section, type and colour.
 *
 * FULL CATALOGUE since 2026-10-19 (_rnd.ts listRndCatalogue): `/tum-urunler`
 * (2,000 colourway cards over 371 models on 2026-10-19 — the same 2,000 under
 * two different sorts, so the round count is not a search-window cap; every
 * stored row and all ~95 listings linked from the home page fall inside it)
 * at 200 cards a page, ~10 pages.
 */
export const SHOP: RndShop = {
  brand: "vans",
  site: "https://www.vans.com.tr",
  listings: [{ path: "/tum-outlet" }],
  detailPath: (id) => `/quicklook?productdescriptionid=${id}`,
  catalogue: [{ path: "/tum-urunler" }],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listRndCatalogue(SHOP, rndLimitsFromEnv("VANS_TR", { maxProducts: 8000, maxPages: 50, detailLimit: 250, budgetMs: 170_000 }));
}
