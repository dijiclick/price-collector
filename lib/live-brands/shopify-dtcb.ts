/**
 * Plain `/products.json` Shopify stores from the 2026-10-21 US/CA "double the
 * brands" package B. Same row shape and contract as SHOPIFY_STORES
 * (./shopify-sites.ts): `/products.json` open to a GitHub runner (probe
 * 39651857674) and `/meta.json` currency = the market's (VICI: USD).
 *
 * The package's other brands need more than the generic reader and live in
 * packages/collector/src/brands/dtcb.ts (Storefront API for USD+CAD from one
 * store, Spanx's two stores, Boden's handle-based gender).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_DTCB: ShopifySite[] = [
  // ~34% of in-stock products reduced (10–73% off), women's.
  { brand: "vici", sites: { US: "https://www.vicicollection.com" }, defaultGender: "kadin" },
];
