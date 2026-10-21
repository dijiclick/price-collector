/**
 * Shopify storefronts from the US/CA "department stores, off-price, multi-brand
 * & shoe/sport retailers" package (2026-10-21). Same row shape as SHOPIFY_STORES
 * in ./shopify-sites; the lead wires this array in.
 *
 * Boathouse (CA): /meta.json currency CAD, /products.json open to a GitHub
 * runner (probe run 39651210627). Multi-brand: the product `vendor` is the
 * real brand (Nike, Carhartt, Vans, …).
 * West 49 (CA) was checked and left out: 0 of its 483 products carry a
 * compare-at price (no sale on, 2026-10-21).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_STORES_PKG: ShopifySite[] = [
  { brand: "boathouse", sites: { CA: "https://www.boathousestores.com" } },
];
