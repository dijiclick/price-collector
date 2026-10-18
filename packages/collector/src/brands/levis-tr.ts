import type { ProductRecord } from "../types";
import { listRnd, rndLimitsFromEnv, type RndShop } from "./_rnd";

/**
 * Levi's Turkey — www.levis.com.tr, an RND Commerce storefront (see _rnd.ts).
 * NOT levi.com.tr: that host is an unrelated pharma/chemicals trading firm
 * (Levi Danışmanlık), checked 2026-10-18. levi.com's own TR locale is behind
 * Akamai (403), as for every other market.
 *
 * Same brand slug as the US/CA adapter (levis.ts, Constructor.io) — the
 * registry picks this one for Turkey with `byMarket`.
 *
 * `/indirim` is the whole sale: on 2026-10-18 it held 256 products and the
 * full `/tum-urunler` walk (1,129) found no reduced product outside it. Its
 * cards carry no section, so it is walked once per `?g=` value; Levi's sells
 * no kids' line in Turkey. ~7 pages, then the quick-view pass for sizes
 * (category, colour and section ride along in its dataLayer push).
 */
export const SHOP: RndShop = {
  brand: "levis",
  site: "https://www.levis.com.tr",
  listings: [
    { path: "/indirim?g=kadin", gender: "kadin" },
    { path: "/indirim?g=erkek", gender: "erkek" },
    { path: "/indirim?g=uniseks", gender: null },
  ],
  detailPath: (id) => `/quicklook?productDescriptionId=${id}`,
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listRnd(SHOP, rndLimitsFromEnv("LEVIS_TR", { maxProducts: 1500, maxPages: 20, detailLimit: 300, budgetMs: 140_000 }));
}
