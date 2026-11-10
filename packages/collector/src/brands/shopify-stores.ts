import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { ALL_SHOPIFY as SHOPIFY_STORES } from "../../../../lib/live-brands/shopify-all";
import { DTCA_BRANDS } from "./shopify-dtca";
import { SHOPIFY_US1110 } from "../../../../lib/live-brands/shopify-us1110";
import { CA1110_OUTLET_BRANDS } from "../../../../lib/live-brands/shopify-ca1110";
import { listShopify } from "./_shopify";

export { SHOPIFY_STORES };

/**
 * Brands whose registry-intl entry dispatches per market itself (one market has
 * its own adapter) — kept out of the generic list so no market runs twice.
 * Gymshark: uk.gymshark.com is headless (own adapter); the other markets'
 * *.shop.gymshark.com stores are plain Shopify.
 */
const OWN_ENTRY = new Set([
  "gymshark",
  // 2026-10-21: Reebok and JD Sports are Shopify only in US/CA (other markets
  // have their own adapters, dispatched in registry-intl); the dtca module
  // serves its brands' every market, incl. the Storefront-API ones.
  "reebok", "jdsports", ...DTCA_BRANDS,
  // 2026-10-21: products.json challenged mid-walk; Storefront API (countryroad.ts).
  "countryroad",
  // 2026-11-10: sale collection through the Storefront API (us1110.ts).
  ...SHOPIFY_US1110.map((s) => s.brand),
  // 2026-11-10: Canadian outlets too big for the full walk — read per sale collection (shopify-ca-outlets.ts).
  ...CA1110_OUTLET_BRANDS,
  // 2026-11-10: Fenwick walks its sale collections and sets `maker` (fenwick.ts).
  "fenwick",
  // 2026-11-10: three Ted Baker storefronts (US Storefront API, UK own, UAE Shopify) — one entry in registry-intl.
  "tedbaker",
]);

export const shopifyStore = (brand: string) => SHOPIFY_STORES.find((s) => s.brand === brand)!;

/** One registry entry per store (lib/live-brands/shopify-sites.ts); the country comes from the registry's market loop. */
export const shopifyAdapters = SHOPIFY_STORES.filter((s) => !OWN_ENTRY.has(s.brand)).map((s) => ({
  brand: s.brand,
  listProducts: (country: CountryCode): Promise<ProductRecord[]> => listShopify(s, country),
}));
