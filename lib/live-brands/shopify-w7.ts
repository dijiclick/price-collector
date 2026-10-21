/**
 * Shopify stores added 2026-10-21 ("double the brands", Asia-Pacific +
 * Australia package). Same row shape as SHOPIFY_STORES (./shopify-sites.ts);
 * the lead merges them in. Each site's `/meta.json` currency matches the market
 * and `/products.json` answered a GitHub runner.
 *
 * - Trenery: Country Road Group's own Shopify store (trenery-au), AUD.
 * - Oh Polly AU: a separate Shopify store (oh-polly-au, AUD) from the UK one
 *   already listed for GB — merge `sites.AU` into the existing ohpolly row.
 * (Witchery, the group's third label, is not here: www.witchery.com.au shows
 *  "currently unavailable" outside Australia and its myshopify store is
 *  password-protected.)
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_W7: ShopifySite[] = [
  { brand: "trenery", sites: { AU: "https://www.trenery.com.au" } },
  { brand: "ohpolly", sites: { AU: "https://au.ohpolly.com" }, defaultGender: "kadin" },
];
