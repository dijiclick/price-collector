/**
 * Shopify stores added by package P4 (2026-10-21). Same row shape as
 * SHOPIFY_STORES. Scalpers runs one Shopify store per market:
 * pt.scalperscompany.com is its own shop (meta.json currency EUR), with live
 * compare-at markdowns. Its EU (eu.scalperscompany.com/fr-fr, de-de, it-it)
 * and Benelux (be./nl.scalperscompany.com) stores had no compare-at prices on
 * 2026-10-21, so they are not listed. The lead may fold this PT site into the
 * existing `scalpers` row of SHOPIFY_STORES (ES) instead of a second row.
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_W4: ShopifySite[] = [{ brand: "scalpers", sites: { PT: "https://pt.scalperscompany.com" } }];
