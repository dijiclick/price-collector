import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { ALL_SHOPIFY as SHOPIFY_STORES } from "../../../../lib/live-brands/shopify-all";
import { DTCA_BRANDS } from "./shopify-dtca";
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
]);

export const shopifyStore = (brand: string) => SHOPIFY_STORES.find((s) => s.brand === brand)!;

/** One registry entry per store (lib/live-brands/shopify-sites.ts); the country comes from the registry's market loop. */
export const shopifyAdapters = SHOPIFY_STORES.filter((s) => !OWN_ENTRY.has(s.brand)).map((s) => ({
  brand: s.brand,
  listProducts: (country: CountryCode): Promise<ProductRecord[]> => listShopify(s, country),
}));
