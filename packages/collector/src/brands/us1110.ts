/**
 * US Shopify stores added 2026-11-10 — one luxury department store and ten
 * famous labels. Each is read through the Storefront API (see _storefront.ts):
 * the shop's own sale collection, in-stock pass first, reduced rows only.
 * Every host answered a GitHub runner tokenless (probe 42799363621) and prices
 * in USD under `@inContext(country: US)`.
 *
 * Lord & Taylor (lordandtaylor.com, relaunched on Shopify as a designer
 * marketplace) is multi-brand: `vendor` is the designer and becomes `maker`.
 * Its `outlet` collection is the durable markdown shelf (5,808 products on
 * 2026-11-10, ~28% of them carrying a compare-at price; seasonal handles such
 * as `fall-sale` come and go). Rows without a compare-at are dropped like
 * everywhere else. It is the largest walk here: ~24 requests for the in-stock
 * pass.
 *
 * Ted Baker tags departments as "Menswear" / "Womenswear", which the generic
 * word-boundary reading misses.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listStorefront, type StorefrontStore } from "./_storefront";

/** Ted Baker's department tag. Pure. */
export function tedBakerGender(tags: string[]): ProductRecord["gender"] {
  const t = tags.join(" | ").toLowerCase();
  if (/\b(kidswear|childrenswear|girlswear|boyswear)\b/.test(t)) return "cocuk";
  if (/\bwomenswear\b/.test(t)) return "kadin";
  if (/\bmenswear\b/.test(t)) return "erkek";
  return null;
}

export const US1110_STORES: StorefrontStore[] = [
  { brand: "lordandtaylor", host: "www.lordandtaylor.com", collection: "outlet", sites: { US: "https://lordandtaylor.com" }, makerFromVendor: true, maxProducts: 2000 },
  { brand: "dkny", host: "www.dkny.com", collection: "sale", sites: { US: "https://www.dkny.com" } },
  { brand: "tedbaker", host: "www.tedbaker.com", collection: "sale", sites: { US: "https://www.tedbaker.com" }, tagGender: tedBakerGender },
  { brand: "sevenforallmankind", host: "7forallmankind.com", collection: "sale", sites: { US: "https://7forallmankind.com" } },
  { brand: "frame", host: "frame-store.com", collection: "all-markdowns", sites: { US: "https://frame-store.com" } },
  { brand: "agjeans", host: "www.agjeans.com", collection: "sale", sites: { US: "https://www.agjeans.com" } },
  { brand: "aliceandolivia", host: "www.aliceandolivia.com", collection: "sale", sites: { US: "https://www.aliceandolivia.com" }, defaultGender: "kadin" },
  { brand: "aninebing", host: "www.aninebing.com", collection: "sale", sites: { US: "https://www.aninebing.com" }, defaultGender: "kadin" },
  { brand: "bcbg", host: "www.bcbg.com", collection: "sale", sites: { US: "https://bcbg.com" }, defaultGender: "kadin" },
  { brand: "juicycouture", host: "www.juicycouture.com", collection: "sale", sites: { US: "https://juicycouture.com" }, defaultGender: "kadin" },
  { brand: "roxy", host: "www.roxy.com", collection: "sale", sites: { US: "https://www.roxy.com" }, defaultGender: "kadin" },
];

export const US1110_BRANDS = US1110_STORES.map((s) => s.brand);

export const listUs1110 = (brand: string, country: CountryCode): Promise<ProductRecord[]> => {
  const store = US1110_STORES.find((s) => s.brand === brand);
  return store ? listStorefront(store, country) : Promise.resolve([]);
};

/** One registry entry per store (Ted Baker is wired by hand: the UK reads another route). */
export const us1110Adapters = US1110_STORES.filter((s) => s.brand !== "tedbaker").map((s) => ({
  brand: s.brand,
  listProducts: (country: CountryCode): Promise<ProductRecord[]> => listStorefront(s, country),
}));
