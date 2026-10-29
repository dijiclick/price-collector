import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listInsider, type InsiderShop } from "./_insider";

/**
 * Mavi TR without touching mavi.com — whose OCC API (p1-api.mavi.com) answers
 * every GitHub runner request 403 at Cloudflare, browser- or app-shaped alike
 * (probe runs 38134846306, 38135122488), and whose www host geo-redirects US
 * egress to the Shopify US store.
 *
 * Instead: Mavi's Insider recommendation feed (see _insider.ts), filtered to
 * `discount.TRY > 0` (Mavi's `discount` is the percentage off: 30, 40, …).
 * Same identities as mavi.ts: `item_id` is the OCC product code
 * (`1614144-70487`) and `groupcode` the `baseProduct`, so rows continue where
 * the old adapter left off. Only in-stock items are in the feed, one
 * representative size per colourway.
 *
 * 2026-10-27 Mavi re-synced its feed without `product_attributes.is_discounted`
 * (and without the jeans' `all_length_variants_v3`), so the old
 * `is_discounted = true` filter matched nothing and every run collected 0. The
 * jeans therefore carry no per-size stock now (`variants` null), like the rest.
 *
 * ~730 discounted colourways from 44 requests (2026-10-29; all 6 working
 * strategies together reach ~740, the old most-popular/top-sellers pair ~707).
 * Every band stays under the 100-row cap (largest 86).
 */
export const SHOP: InsiderShop = {
  brand: "mavi",
  partnerName: "mavi",
  discountFilter: "[discount.TRY][>][0]",
  priceEdges: [1, 300, 400, 500, 600, 750, 950, 1100, 1250, 1500, 1800, 100000],
  strategies: ["new-arrivals", "highest-discounted", "trending", "most-valuable"],
  rowKind: "colour",
  defaultGender: null,
};

export const brand = SHOP.brand;

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  return listInsider(SHOP, country);
}
