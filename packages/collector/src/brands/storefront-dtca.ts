import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listStorefront, type StorefrontStore } from "./_storefront";

/**
 * Canada for US Shopify stores whose CA market lives inside the US shop
 * (Shopify Markets, USD base) — "double the brands" package dtca, 2026-10-21.
 *
 * Their `/products.json` prices in USD whatever market is asked for, so they
 * cannot go in a `ShopifySite` CA row. The Storefront API with
 * `@inContext(country: CA)` prices them in CAD (checked per shop: the
 * `localization` query answers CA/CAD) and `toProductsJson` drops any row the
 * API still prices in another currency. All answered TOKENLESS. The US side of
 * each brand stays on `/products.json` (lib/live-brands/shopify-dtca.ts, or
 * SHOPIFY_STORES for Alo and Princess Polly) — except Sperry, whose US row is
 * here too (see its entry).
 *
 * `sites.CA` is the public product-page origin a Canadian shopper lands on:
 * the `/en-ca` Markets subfolder where the shop has one (hreflang en-CA),
 * otherwise the root, which geolocates to CAD.
 *
 * Left out on purpose: Betsey Johnson (its CA market still prices in USD),
 * Marine Layer (same), Oh Polly (ca.ohpolly.com is a separate shop whose
 * Online Store channel is locked to the API and whose /products.json is 401),
 * Tuckernuck (its Storefront API answers catalogue pages with INTERNAL_SERVER_ERROR on both hosts).
 */
export const STOREFRONT_DTCA: StorefrontStore[] = [
  { brand: "eddiebauer", host: "www.eddiebauer.com", collection: "sale", sites: { CA: "https://www.eddiebauer.com/en-ca" } },
  { brand: "goodamerican", host: "www.goodamerican.com", collection: "sale", sites: { CA: "https://www.goodamerican.com/en-ca" }, defaultGender: "kadin" },
  // www.dollskill.com answers the Storefront API with INTERNAL_SERVER_ERROR; its myshopify host does not.
  { brand: "dollskill", host: "dolls-test.myshopify.com", collection: "all-sale", sites: { CA: "https://www.dollskill.com" }, defaultGender: "kadin" },
  { brand: "princesspolly", host: "us.princesspolly.com", collection: "sale", sites: { CA: "https://us.princesspolly.com" }, defaultGender: "kadin" },
  { brand: "motelrocks", host: "us.motelrocks.com", collection: "sale", sites: { CA: "https://us.motelrocks.com" }, defaultGender: "kadin" },
  // No women's sale collection: markdowns sit in place, so the whole catalogue is scanned.
  { brand: "aloyoga", host: "www.aloyoga.com", sites: { CA: "https://www.aloyoga.com/en-ca" } },
  { brand: "calpak", host: "www.calpaktravel.com", collection: "sale", sites: { CA: "https://www.calpaktravel.com" } },
  { brand: "petalandpup", host: "petalandpup.com", collection: "sale", sites: { CA: "https://petalandpup.com" }, defaultGender: "kadin" },
  // US too (2026-10-25): its /products.json still lists rows the US market has dropped, and those
  // pages 404 or redirect home (13 of a 25-row sale sample); the API in US context returns none of them.
  { brand: "sperry", host: "www.sperry.com", collection: "sale", sites: { US: "https://www.sperry.com", CA: "https://www.sperry.com/en-ca" } },
];

/** One registry entry per store, like storefrontAdapters; the country comes from the registry's market loop. */
export const storefrontDtcaAdapters = STOREFRONT_DTCA.map((s) => ({
  brand: s.brand,
  listProducts: (country: CountryCode): Promise<ProductRecord[]> => listStorefront(s, country),
}));
