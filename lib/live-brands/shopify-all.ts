/**
 * Every Shopify storefront the collector and the pasted-link resolver know:
 * the base list (shopify-sites.ts) plus the stores each 2026-10-21 "double the
 * brands" package verified in its own file. Rows for the same brand merge their
 * markets, so a package can add a country to an existing store without editing
 * the base list.
 */
import { SHOPIFY_STORES, type ShopifySite } from "./shopify-sites";
import { SHOPIFY_BEAUTY } from "./shopify-beauty";
import { SHOPIFY_CANADA } from "./shopify-canada";
import { SHOPIFY_DTCB } from "./shopify-dtcb";
import { SHOPIFY_DTCC } from "./shopify-dtcc";
import { SHOPIFY_OTHER } from "./shopify-other";
import { SHOPIFY_STORES_PKG } from "./shopify-stores";
import { SHOPIFY_W4 } from "./shopify-w4";
import { SHOPIFY_W7 } from "./shopify-w7";
import { SHOPIFY_W1 } from "./shopify-w1";

/** Markets added to stores already in the base list (each runner-verified 2026-10-21). */
const EXTRA_SITES: ShopifySite[] = [
  // Fenty CA: the /en-ca folder prices in CAD (cart.js), same value-set filter as US.
  { brand: "fentybeauty", sites: { CA: "https://fentybeauty.com/en-ca" } },
  // White Fox CA: whitefoxboutique.ca prices in CAD (46.00 CAD vs 45.47 AUD).
  { brand: "whitefox", sites: { CA: "https://www.whitefoxboutique.ca" } },
];

function merge(lists: ShopifySite[][]): ShopifySite[] {
  const by = new Map<string, ShopifySite>();
  for (const row of lists.flat()) {
    const had = by.get(row.brand);
    by.set(row.brand, had ? { ...had, ...row, sites: { ...had.sites, ...row.sites } } : row);
  }
  return [...by.values()];
}

export const ALL_SHOPIFY: ShopifySite[] = merge([
  SHOPIFY_STORES, SHOPIFY_BEAUTY as ShopifySite[], SHOPIFY_CANADA, SHOPIFY_DTCB, SHOPIFY_DTCC,
  SHOPIFY_OTHER, SHOPIFY_STORES_PKG, SHOPIFY_W4, SHOPIFY_W7, SHOPIFY_W1, EXTRA_SITES,
]);
