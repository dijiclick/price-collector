import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Cacharel Turkey — Akinon (see _akinon.ts), the Pierre Cardin attribute
 * scheme. The whole `/list/` catalogue is returned, reduced and full price
 * (3,406 rows = 14 pages of 250, 2026-10-19). Listing rows embed per-size stock.
 */
export const SHOP: AkinonShop = {
  brand: "cacharel",
  site: "https://www.cacharel.com.tr",
  listPath: "/list/",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filterable_detail_color", "filterable_color"],
  categoryAttrs: ["filterable_product_base_type", "filterable_product_type"],
  genderAttrs: ["filterable_gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("CACHAREL", { maxProducts: 10_000, maxPages: 40, detailLimit: 30 }));
}
