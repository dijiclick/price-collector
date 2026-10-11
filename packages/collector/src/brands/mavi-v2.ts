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
 * `product_attributes.is_discounted = true`. Same identities as mavi.ts:
 * `item_id` is the OCC product code (`1614144-70487`) and `groupcode` the
 * `baseProduct`, so rows continue where the old adapter left off. Only in-stock
 * items are in the feed. Per-size stock exists only for jeans (waist/length);
 * the rest carry one representative size, so `variants` is null for them.
 *
 * ~650 discounted colourways from 40 requests (2026-10-11); 8 strategies' worth
 * of union gains only ~10 more, so 4 are walked.
 */
export const SHOP: InsiderShop = {
  brand: "mavi",
  partnerName: "mavi",
  discountFilter: "[product_attributes.is_discounted][=][true]",
  priceEdges: [1, 300, 400, 500, 600, 750, 950, 1100, 1250, 1800, 100000],
  strategies: ["most-popular", "new-arrivals", "highest-discounted", "top-sellers"],
  rowKind: "colour",
  defaultGender: null,
};

export const brand = SHOP.brand;

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  return listInsider(SHOP, country);
}
