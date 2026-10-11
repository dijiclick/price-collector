import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listInsider, type InsiderShop } from "./_insider";

/**
 * Twist TR without touching twist.com.tr — the whole host (pages and the
 * `/_next/data` JSON twist.ts reads) is a Cloudflare challenge for GitHub's
 * runners (probe run 38134846306).
 *
 * Instead: Twist's Insider recommendation feed (partner `ipekyoltwist`, see
 * _insider.ts), filtered to `discount.TRY > 0` — which is the OUTLET category.
 * The feed has one row per SIZE; rows merge by `groupcode`, and the record id
 * is `product_attributes.old_group_id`, which is the storefront product id
 * twist.ts already stores (20379 ↔ TS1260002668015, checked 2026-10-11), and
 * the url is the same `/urun/<routePath>`.
 *
 * Sizes: the feed lists in-stock items only, so `variants` holds the sizes that
 * are available now — useful on the card, but it cannot by itself raise a
 * per-size restock (that needs an explicit out_of_stock reading).
 */
export const SHOP: InsiderShop = {
  brand: "twist",
  partnerName: "ipekyoltwist",
  discountFilter: "[discount.TRY][>][0]",
  priceEdges: [1, 800, 1100, 1400, 1700, 2000, 2400, 2900, 3500, 4500, 100000],
  strategies: ["most-popular", "new-arrivals", "highest-discounted"],
  rowKind: "size",
  defaultGender: "kadin",
};

export const brand = SHOP.brand;

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  return listInsider(SHOP, country);
}
