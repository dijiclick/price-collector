import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Pierre Cardin Turkey — Akinon (see _akinon.ts). No sale category; about
 * half of the ~7,400-row `/list/` catalogue is reduced, so the walk stops once
 * 2,000 discounted rows are in hand. Listing rows embed per-size stock in
 * `extra_data.variants`, so no PDP calls are needed.
 */
export const SHOP: AkinonShop = {
  brand: "pierrecardin",
  site: "https://www.pierrecardin.com.tr",
  listPath: "/list/",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filterable_detail_color", "filterable_color"],
  categoryAttrs: ["filterable_product_type", "filterable_product_base_type"],
  genderAttrs: ["filterable_gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("PIERRECARDIN", { maxProducts: 2000, maxPages: 80, detailLimit: 300 }));
}
