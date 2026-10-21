/**
 * US/CA direct-to-consumer Shopify brands, "double the brands" package B
 * (2026-10-21). Every route answered a GitHub runner directly (probe
 * 39651857674); no proxy.
 *
 * Storefront API (see _storefront.ts), because one Shopify store serves both
 * markets: `@inContext(country: CA)` prices the same store in CAD from the
 * shop's own CA price list — checked against `/products/<handle>.js` with the
 * CA localization cookie (Faherty 298/335 CAD, Everlane 17/56 CAD, Beyond Yoga
 * 80/106 CAD on 2026-10-21). These stores have no /en-ca path: Canadians get
 * the same product URL, priced by cookie/geo. Each walks the shop's own sale
 * collection, in-stock pass first.
 *
 * Boden US is the generic `/products.json` reader plus a gender fix: Boden
 * tags only `stylecode:…`, and the department is the handle prefix
 * (`women-…`, `men-…`, `girls-…`, `boys-…`, `baby-…`).
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listStorefront, type StorefrontStore } from "./_storefront";
import { listShopify, type ShopifyStore } from "./_shopify";

export const STOREFRONT_DTCB: StorefrontStore[] = [
  // "All Sale Clothing" — women's and men's in one collection, ~1,500 reduced rows.
  { brand: "everlane", host: "www.everlane.com", collection: "all-sale-clothing", sites: { US: "https://www.everlane.com", CA: "https://www.everlane.com" } },
  // Women's activewear; men's rows carry a men tag.
  { brand: "beyondyoga", host: "beyondyoga.com", collection: "sale-view-all", sites: { US: "https://beyondyoga.com", CA: "https://beyondyoga.com" }, defaultGender: "kadin" },
  { brand: "alexandani", host: "www.alexandani.com", collection: "all-sale", sites: { US: "https://www.alexandani.com", CA: "https://www.alexandani.com" }, defaultGender: "kadin" },
  { brand: "faherty", host: "www.fahertybrand.com", collection: "sale", sites: { US: "https://fahertybrand.com", CA: "https://fahertybrand.com" } },
  // US only: the CA market's `ca-sale` collection carries no compare-at price in CAD (0 rows).
  { brand: "away", host: "www.awaytravel.com", collection: "sale", sites: { US: "https://www.awaytravel.com" } },
];

/** Spanx runs two Shopify stores: spanx.com (USD, no CA market) and spanx.ca (CAD). */
export const SPANX_US: StorefrontStore = { brand: "spanx", host: "spanx.com", collection: "sale", sites: { US: "https://spanx.com" }, defaultGender: "kadin" };
export const SPANX_CA: StorefrontStore = { brand: "spanx", host: "spanx-ca-com.myshopify.com", collection: "sale", sites: { CA: "https://spanx.ca" }, defaultGender: "kadin" };

export const listSpanx = (country: CountryCode): Promise<ProductRecord[]> =>
  country === "CA" ? listStorefront(SPANX_CA, country) : listStorefront(SPANX_US, country);

export const BODEN: ShopifyStore = { brand: "boden", sites: { US: "https://us.boden.com" } };

/** Boden's department, from the product handle in the URL. Pure. */
export function bodenGender(url: string): ProductRecord["gender"] {
  const h = url.split("/products/")[1] ?? "";
  if (/^(girls|boys|baby|kids|toddler)-/.test(h)) return "cocuk";
  if (/^women-/.test(h)) return "kadin";
  if (/^men-/.test(h)) return "erkek";
  return null;
}

export const listBoden = async (country: CountryCode): Promise<ProductRecord[]> =>
  (await listShopify(BODEN, country)).map((r) => ({ ...r, gender: bodenGender(r.url) ?? r.gender }));

const byBrand = (b: string) => STOREFRONT_DTCB.find((s) => s.brand === b)!;
export const listEverlane = (c: CountryCode) => listStorefront(byBrand("everlane"), c);
export const listBeyondYoga = (c: CountryCode) => listStorefront(byBrand("beyondyoga"), c);
/**
 * Alex and Ani types its multi-item bundles ("Wizard of Oz™ … Bundle", "UNO™
 * Collector's Pack") as "Non Merchandise"; their compare-at is the sum of the
 * parts — a multi-buy price, not a markdown — so they are dropped.
 */
export const listAlexAndAni = async (c: CountryCode) =>
  (await listStorefront(byBrand("alexandani"), c)).filter((r) => !/^non merchandise$/i.test(r.category ?? ""));
export const listFaherty = (c: CountryCode) => listStorefront(byBrand("faherty"), c);
export const listAway = (c: CountryCode) => listStorefront(byBrand("away"), c);
