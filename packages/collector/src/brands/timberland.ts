import type { ProductRecord } from "../types";
import { listRnd, rndLimitsFromEnv, type RndShop } from "./_rnd";

/**
 * Timberland Turkey — www.timberland.com.tr, an RND Commerce storefront (see
 * _rnd.ts). The outlet is split by section (`/outlet` itself is a landing
 * page): 301 + 130 + 29 products on 2026-10-18, ~11 pages; the department
 * trees held almost no strike prices (/erkek page 1: 2 of 48). The cards' GA4
 * item gives section, type and colour; sizes come from `/urun/getdetail`
 * (Timberland's `/quicklook` answers 404).
 */
export const SHOP: RndShop = {
  brand: "timberland",
  site: "https://www.timberland.com.tr",
  listings: [
    { path: "/outlet-erkek", gender: "erkek" },
    { path: "/outlet-kadin", gender: "kadin" },
    { path: "/outlet-cocuk", gender: "cocuk" },
  ],
  detailPath: (id) => `/urun/getdetail?productId=${id}&viewName=QuickDetail&quicklook=True`,
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listRnd(SHOP, rndLimitsFromEnv("TIMBERLAND", { maxProducts: 1500, maxPages: 25, detailLimit: 250, budgetMs: 140_000 }));
}
