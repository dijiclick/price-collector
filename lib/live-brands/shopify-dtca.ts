/**
 * US/CA Shopify DTC fashion stores ("double the brands", package dtca,
 * 2026-10-21). Same row shape and rules as SHOPIFY_STORES: every site answered
 * a GitHub runner with an open `/products.json` and its `/meta.json` currency
 * matched the market it is listed for (probe run 39649843881).
 *
 * Stores whose Canada market lives inside the US shop (Shopify Markets, one
 * USD base) are NOT here — their `/products.json` prices in USD for every
 * market. They are read through the Storefront API with `@inContext(country:
 * CA)` instead: packages/collector/src/brands/storefront-dtca.ts.
 *
 * Brandy Melville (us./ca.brandymelville.com) answered fine but carries no
 * compare-at price on any product — nothing to collect, so it is not listed.
 * Bundles (Betsey Johnson, Calpak) are dropped by the adapter wrapper in
 * packages/collector/src/brands/shopify-dtca.ts: their "was" is a sum of items.
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_DTCA: ShopifySite[] = [
  { brand: "eddiebauer", sites: { US: "https://www.eddiebauer.com" } },
  { brand: "ohpolly", sites: { US: "https://us.ohpolly.com" }, defaultGender: "kadin" },
  { brand: "tuckernuck", sites: { US: "https://tnuck.com" }, defaultGender: "kadin" },
  { brand: "dollskill", sites: { US: "https://www.dollskill.com" }, defaultGender: "kadin" },
  { brand: "charlotterusse", sites: { US: "https://charlotterusse.com" }, defaultGender: "kadin" },
  { brand: "marinelayer", sites: { US: "https://www.marinelayer.com" } },
  { brand: "petalandpup", sites: { US: "https://petalandpup.com" }, defaultGender: "kadin" },
  { brand: "motelrocks", sites: { US: "https://us.motelrocks.com" }, defaultGender: "kadin" },
  { brand: "goodamerican", sites: { US: "https://www.goodamerican.com" }, defaultGender: "kadin" },
  { brand: "calpak", sites: { US: "https://www.calpaktravel.com" } },
  { brand: "ninewest", sites: { US: "https://ninewest.com", CA: "https://www.ninewest.ca" }, defaultGender: "kadin" },
  { brand: "sperry", sites: { US: "https://www.sperry.com" } },
  { brand: "betseyjohnson", sites: { US: "https://betseyjohnson.com" }, defaultGender: "kadin" },
];
