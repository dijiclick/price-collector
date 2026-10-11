import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * M·A·C Cosmetics Turkey — Akinon (see _akinon.ts). The whole `/list/`
 * catalogue is only ~360 rows (4 pages), so it is walked and the reduced rows
 * kept (`/ozel-indirimler/` holds just 22). A row is one SHADE (`SHADENAME`),
 * whose siblings are the colour group; the size group (`PRODUCT_SIZE`, e.g.
 * `3.5 ML`) carries that shade's own stock, which is what a restock alert needs.
 */
export const SHOP: AkinonShop = {
  brand: "maccosmetics",
  site: "https://www.maccosmetics.com.tr",
  listPath: "/list/",
  sizeKey: "PRODUCT_SIZE",
  colorKey: "SHADENAME",
  colorNameAttrs: ["SHADENAME"],
  categoryAttrs: ["CATEGORY_LEVEL_3", "CATEGORY_LEVEL_2", "boost_text"],
  genderAttrs: [],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("MACCOSMETICS", { maxProducts: 1500, maxPages: 10, detailLimit: 30 }));
}
