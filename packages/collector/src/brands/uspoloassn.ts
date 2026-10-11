import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * U.S. Polo Assn. Turkey — Akinon (see _akinon.ts), the same attribute scheme
 * as Pierre Cardin and Cacharel. `/indirim-festivali/` is the sale category
 * (~9,200 rows, ~70% reduced, 2026-10-11); the walk stops at the cap. Listing
 * rows embed per-size stock in `extra_data.variants`.
 */
export const SHOP: AkinonShop = {
  brand: "uspoloassn",
  site: "https://tr.uspoloassn.com",
  listPath: "/indirim-festivali/",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filterable_detail_color", "filterable_color"],
  categoryAttrs: ["filterable_product_base_type", "filterable_product_type"],
  genderAttrs: ["filterable_gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("USPOLOASSN", { maxProducts: 1500, maxPages: 42, detailLimit: 15 }));
}
