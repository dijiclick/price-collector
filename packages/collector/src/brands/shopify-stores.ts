import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { SHOPIFY_STORES } from "../../../../lib/live-brands/shopify-sites";
import { listShopify } from "./_shopify";

export { SHOPIFY_STORES };

/** One registry entry per store (lib/live-brands/shopify-sites.ts); the country comes from the registry's market loop. */
export const shopifyAdapters = SHOPIFY_STORES.map((s) => ({
  brand: s.brand,
  listProducts: (country: CountryCode): Promise<ProductRecord[]> => listShopify(s, country),
}));
