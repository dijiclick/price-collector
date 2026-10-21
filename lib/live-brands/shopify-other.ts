/**
 * Shopify storefronts from the 2026-10-21 US/CA "other platforms" package.
 * Same row shape as SHOPIFY_STORES (./shopify-sites); the lead wires this
 * array in. Each site's `/meta.json` currency matched its market and its
 * `/products.json` answered a GitHub runner (probe run 39651678399).
 *
 * Checked and left out: Touchland, JW PEI (no compare-at prices at all),
 * Tower 28 (its only "reductions" are sets priced below the sum of their
 * parts — gift-set worth values, not markdowns).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_OTHER: ShopifySite[] = [
  // QUAY (quayusa.myshopify.com, USD): ~20 sunglasses on its evergreen sale.
  { brand: "quay", sites: { US: "https://www.quay.com" } },
];
