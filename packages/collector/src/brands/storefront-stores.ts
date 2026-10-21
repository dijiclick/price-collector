import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listStorefront, type StorefrontStore } from "./_storefront";

/**
 * Aldo prefixes its merchandising tags by department: `w-clearance`,
 * `w-block-heel` (women) vs `m-oxford`, `m-loafer` (men). The majority wins;
 * a tie or no prefixed tag stays unknown (bags are often untagged).
 */
export function aldoGender(tags: string[]): ProductRecord["gender"] {
  const w = tags.filter((t) => /^w-/i.test(t)).length;
  const m = tags.filter((t) => /^m-/i.test(t)).length;
  return w > m ? "kadin" : m > w ? "erkek" : null;
}

/**
 * Shopify shops with a closed `/products.json`, read through the Storefront
 * API instead (see _storefront.ts). All four answered TOKENLESS on 2026-10-11,
 * so no key is stored here. Hosts are the API hosts that answered; `sites` are
 * the public product-page origins per market.
 */
export const STOREFRONT_STORES: StorefrontStore[] = [
  // Headless (Remix). One store with Markets: @inContext prices USD/CAD/GBP.
  {
    brand: "skims",
    host: "skims.com",
    collection: "skims-sale",
    sites: {
      US: "https://skims.com", CA: "https://skims.com/en-ca", GB: "https://skims.com/en-gb",
      // 2026-10-21: Markets price AUD/HKD/JPY/KRW/SGD (localization answers each).
      // Links use the root: skims.com geolocates the visitor to their market.
      AU: "https://skims.com", HK: "https://skims.com", JP: "https://skims.com", KR: "https://skims.com", SG: "https://skims.com",
    },
    defaultGender: "kadin",
    // A relaunched product keeps its old listing renamed `<name>-old-<colour>`
    // (`cotton-fleece-jogger-old-old-light-heather-grey`, in skims-sale, 404s).
    // All 7 such handles of 3,844 (2026-10-21) have a live twin without "-old";
    // no current handle has an "old" word ("gold", "foldover" lack the hyphen).
    skipHandle: /-old(-|$)/,
  },
  // Hydrogen. "Women's Clothing on Sale"; men's/kids' rows carry their own tags.
  {
    brand: "fashionnova",
    host: "www.fashionnova.com",
    collection: "sale",
    sites: { US: "https://www.fashionnova.com", CA: "https://www.fashionnova.com" },
    defaultGender: "kadin",
  },
  // Slug is the full host word: a bare "elf" would also claim selfridges.com.
  // No sale collection: e.l.f. marks down a handful of bundles in place, so
  // the whole catalogue (~1,200 products, 5 pages) is scanned for compare-at.
  {
    brand: "elfcosmetics",
    host: "mbw1zp-yd.myshopify.com",
    sites: { US: "https://www.elfcosmetics.com" },
  },
  // Oh Polly's UK store (GB runs through /products.json, lib/live-brands/
  // shopify-sites.ts). Ireland is its euro Market on eu.ohpolly.com: tokenless
  // Storefront API with @inContext(IE) answers EUR prices (2026-10-21).
  {
    brand: "ohpolly",
    host: "www.ohpolly.com",
    collection: "sale",
    sites: { IE: "https://eu.ohpolly.com" },
    defaultGender: "kadin",
  },
  // One Shopify store, US at the root and Canada under /en-ca (CAD via Markets).
  {
    brand: "aldo",
    host: "www.aldoshoes.com",
    collection: "sale",
    sites: { CA: "https://www.aldoshoes.com/en-ca", US: "https://www.aldoshoes.com" },
    tagGender: aldoGender,
  },
];

const byBrand = (b: string) => STOREFRONT_STORES.find((s) => s.brand === b)!;

export const listSkims = (country: CountryCode): Promise<ProductRecord[]> => listStorefront(byBrand("skims"), country);
export const listFashionNova = (country: CountryCode): Promise<ProductRecord[]> => listStorefront(byBrand("fashionnova"), country);
export const listElf = (country: CountryCode): Promise<ProductRecord[]> => listStorefront(byBrand("elfcosmetics"), country);
export const listAldo = (country: CountryCode): Promise<ProductRecord[]> => listStorefront(byBrand("aldo"), country);

/** One registry entry per store, like shopifyAdapters; the country comes from the registry's market loop. */
export const storefrontAdapters = STOREFRONT_STORES.map((s) => ({
  brand: s.brand,
  listProducts: (country: CountryCode): Promise<ProductRecord[]> => listStorefront(s, country),
}));
export const listOhPollyIe = (country: CountryCode): Promise<ProductRecord[]> => listStorefront(byBrand("ohpolly"), country);
