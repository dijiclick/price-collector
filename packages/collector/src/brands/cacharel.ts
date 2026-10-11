import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Cacharel Turkey — Akinon (see _akinon.ts), the Pierre Cardin attribute
 * scheme. No single sale category (`/outlet-ozel-uretim/` is only 600 rows);
 * ~85% of the 3,459-row `/list/` catalogue is reduced (2026-10-11), so the
 * whole list is walked up to the cap. Listing rows embed per-size stock.
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
  return listAkinon(SHOP, limitsFromEnv("CACHAREL", { maxProducts: 1500, maxPages: 25, detailLimit: 30 }));
}
