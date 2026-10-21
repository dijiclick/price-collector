/**
 * Country Road (countryroad.com.au) — AU, Shopify. Collected through the
 * generic `/products.json` walk until 2026-10-21, when it started coming back
 * short: 347 rows at 14:00 UTC, 1 at 16:00, 0 at 19:20, 346 at 21:00. The
 * catalogue is ~40 pages of 250 with the markdowns thinly spread, and Shopify's
 * bot check answers a burst of `/products.json` (and collection JSON) with a
 * 429 "Verifying your connection" challenge — seen from this Mac after ~5
 * requests, on www and on the myshopify host alike. A page that stays
 * challenged through the retries ended the walk early, so whatever had been
 * read so far (often nothing) was the run.
 *
 * The Storefront API on `country-road-au.myshopify.com` is not behind that
 * challenge (it answered while products.json was 429ing, and from a runner).
 * The token is Shopify's public one from the page's `shopify-features` blob.
 * The `sale` collection is the whole markdown set (~920 in stock + ~590 sold
 * out, every row reduced) — 16 requests of 100 instead of 40 of 250.
 *
 * Gender comes from the per-department sale collections, read first; the
 * catch-all `sale` adds what they miss (home, gifts) without a gender.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listSaleStore, type SaleStore } from "./_storefrontsale";

const ORIGIN = "https://www.countryroad.com.au";
const CAP = 1500;

const base: SaleStore = {
  brand: "countryroad",
  apiHost: "country-road-au.myshopify.com",
  token: process.env.COUNTRYROAD_STOREFRONT_TOKEN ?? "24c78985a441fc1976447792da46c5e2",
  tokenPage: `${ORIGIN}/`,
  collections: ["sale"],
  productUrl: (h) => `${ORIGIN}/products/${h}`,
};

/** Read in this order; a product keeps the gender of the first collection it is found in. */
export const COUNTRYROAD_PASSES: SaleStore[] = [
  { ...base, collections: ["sale-man"], gender: "erkek" },
  { ...base, collections: ["sale-child", "sale-teen"], gender: "cocuk" },
  { ...base, collections: ["sale-woman"], gender: "kadin" },
  { ...base, collections: ["sale"] },
];

export async function listCountryRoad(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AU") return [];
  const byId = new Map<string, ProductRecord>();
  for (const pass of COUNTRYROAD_PASSES) {
    for (const r of await listSaleStore(pass, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
