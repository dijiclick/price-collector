import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * U.S. Polo Assn. Turkey — Akinon (see _akinon.ts), the same attribute scheme
 * as Pierre Cardin and Cacharel. The whole `/list/` catalogue is returned,
 * reduced and full price (9,157 rows = 37 pages of 250, 2026-10-19; the
 * `/indirim-festivali/` campaign is the same catalogue, its 4,802 reduced rows
 * at the same prices). Listing rows embed per-size stock in
 * `extra_data.variants`. The catalogue is close to the 10,000-row result
 * window; past it the walk switches to the two price-sorted halves (see
 * walkAkinonListing).
 */
export const SHOP: AkinonShop = {
  brand: "uspoloassn",
  site: "https://tr.uspoloassn.com",
  listPath: "/list/",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filterable_detail_color", "filterable_color"],
  categoryAttrs: ["filterable_product_base_type", "filterable_product_type"],
  genderAttrs: ["filterable_gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("USPOLOASSN", { maxProducts: 20_000, maxPages: 82, detailLimit: 15 }));
}
