/**
 * US Shopify storefronts added 2026-11-10 (owner: luxury / off-price stores and
 * famous brands we lacked). Each store's Storefront API answered a GitHub
 * runner (probe 42799363621) and prices in USD. The collector walks each
 * shop's own sale collection through the Storefront API
 * (packages/collector/src/brands/us1110.ts), so these rows are for the
 * pasted-link resolver (`/products/<handle>.js`) only — the brands are kept
 * out of the generic `/products.json` walker in shopify-stores.ts.
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_US1110: ShopifySite[] = [
  // Multi-brand luxury department store (relaunched on Shopify): Gucci, Valentino, Balenciaga…
  { brand: "lordandtaylor", sites: { US: "https://lordandtaylor.com" } },
  { brand: "dkny", sites: { US: "https://www.dkny.com" } },
  { brand: "tedbaker", sites: { US: "https://www.tedbaker.com" } },
  { brand: "sevenforallmankind", sites: { US: "https://7forallmankind.com" } },
  { brand: "frame", sites: { US: "https://frame-store.com" } },
  { brand: "agjeans", sites: { US: "https://www.agjeans.com" } },
  { brand: "aliceandolivia", sites: { US: "https://www.aliceandolivia.com" }, defaultGender: "kadin" },
  { brand: "aninebing", sites: { US: "https://www.aninebing.com" }, defaultGender: "kadin" },
  { brand: "bcbg", sites: { US: "https://bcbg.com" }, defaultGender: "kadin" },
  { brand: "juicycouture", sites: { US: "https://juicycouture.com" }, defaultGender: "kadin" },
  { brand: "roxy", sites: { US: "https://www.roxy.com" }, defaultGender: "kadin" },
];
