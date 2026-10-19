import type { ProductRecord } from "../types";
import { listRndCatalogue, rndLimitsFromEnv, type RndShop } from "./_rnd";

/**
 * Timberland Turkey — www.timberland.com.tr, an RND Commerce storefront (see
 * _rnd.ts). The outlet is split by section (`/outlet` itself is a landing
 * page): 301 + 130 + 29 products on 2026-10-18, ~11 pages; the department
 * trees held almost no strike prices (/erkek page 1: 2 of 48). The cards' GA4
 * item gives section, type and colour; sizes come from `/urun/getdetail`
 * (Timberland's `/quicklook` answers 404).
 *
 * FULL CATALOGUE since 2026-10-19 (_rnd.ts listRndCatalogue): the three
 * outlet sections first — so every reduced card keeps the section the outlet
 * walk gave it when its GA4 item names none — then `/tum-urunler` (1,256
 * products on 2026-10-19, the outlet inside it; all ~100 listings linked from
 * the home page fall inside it) for the rest. 200 cards a page, ~11 pages,
 * each listing checked against its own "N Ürün" count.
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
  catalogue: [
    { path: "/outlet-erkek", gender: "erkek" },
    { path: "/outlet-kadin", gender: "kadin" },
    { path: "/outlet-cocuk", gender: "cocuk" },
    { path: "/tum-urunler" },
  ],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listRndCatalogue(SHOP, rndLimitsFromEnv("TIMBERLAND", { maxProducts: 6000, maxPages: 40, detailLimit: 250, budgetMs: 170_000 }));
}
