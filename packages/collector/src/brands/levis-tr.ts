import type { ProductRecord } from "../types";
import { listRnd, listRndCatalogue, rndLimitsFromEnv, type RndShop } from "./_rnd";

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
 *
 * 2026-11-02: `/indirim` went empty ("DEPARTMANDA ÜRÜN YOK") while 260
 * reduced products were still on sale inside `/tum-urunler`; the run collected
 * 0 twice. The walk now reads `/tum-urunler` sorted by discount, descending
 * (`o=12`, "Azalan İndirim"), so the reduced cards come first and the walk
 * stops at the first page without one, whatever the sale landing page does.
 *
 * STAYS SALE-ONLY (checked 2026-10-19): no listing holds the whole shop.
 * `/tum-urunler` counts 1,124, but the ~90 category listings linked from the
 * home page add 213 more products (13 of 15 sampled in stock, 20 of them in
 * `/indirim`), and the categories are curated sets, not a tree (a parent
 * misses its children's products). A full-price walk could not be shown
 * complete, and the delist sweep would mark whatever it missed sold out.
 *
 * BETWEEN SALES (2026-11-03): the sale ended — every card in all three
 * sections is a single price and `/indirim` is empty — so the sale walk
 * returned 0 and every run failed (7 in a row), leaving 236 stored rows at
 * their old sale prices. With no reduced card anywhere the run now walks the
 * three sections in full (544 + 790 + 3 = 1,337 of `/tum-urunler`'s 1,338,
 * each checked against its own pager count) and returns them at full price,
 * as COS and Gullfunn do. The ~200 category-only products stay unlisted.
 *
 * TAIL OF A SALE (2026-11-08): one reduced product was left, so the sale walk
 * returned 1 row and the fallback (0 only) never ran — four runs flagged
 * `drop` (1 of 1,396) and the delist sweep would have marked the rest sold
 * out. Under MIN_SALE_ROWS the catalogue walk runs instead; it reads the same
 * cards, so the few reduced ones keep their strike price. If that walk fails,
 * the sale rows are still returned.
 */
export const MIN_SALE_ROWS = 30;

export const SHOP: RndShop = {
  brand: "levis",
  site: "https://www.levis.com.tr",
  listings: [
    { path: "/tum-urunler?g=kadin&o=12", gender: "kadin" },
    { path: "/tum-urunler?g=erkek&o=12", gender: "erkek" },
    { path: "/tum-urunler?g=uniseks&o=12", gender: null },
  ],
  detailPath: (id) => `/quicklook?productDescriptionId=${id}`,
  catalogue: [
    { path: "/tum-urunler?g=kadin", gender: "kadin" },
    { path: "/tum-urunler?g=erkek", gender: "erkek" },
    { path: "/tum-urunler?g=uniseks", gender: null },
  ],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  const sale = await listRnd(SHOP, rndLimitsFromEnv("LEVIS_TR", { maxProducts: 1500, maxPages: 20, detailLimit: 300, budgetMs: 140_000 }));
  if (sale.length >= MIN_SALE_ROWS) return sale;
  try {
    return await listRndCatalogue(SHOP, rndLimitsFromEnv("LEVIS_TR_FULL", { maxProducts: 3000, maxPages: 15, detailLimit: 200, budgetMs: 150_000 }));
  } catch (err) {
    if (!sale.length) throw err;
    console.warn(`levis TR: catalogue walk failed (${(err as Error).message}); keeping ${sale.length} sale rows`);
    return sale;
  }
}
