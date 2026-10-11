import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Flormar Turkey — Akinon (see _akinon.ts). No usable sale category
 * (`/kampanyalar/` is a CMS page), and the whole `/list/` catalogue is only
 * ~1,280 rows (13 pages), so it is walked and the reduced rows kept. A row is
 * one SHADE (`ent_product_color_code`); there is no size group, so stock is the
 * row's own `in_stock` and no PDP calls are made.
 */
export const SHOP: AkinonShop = {
  brand: "flormar",
  site: "https://www.flormar.com.tr",
  listPath: "/list/",
  sizeKey: "ent_size",
  colorKey: "ent_product_color_code",
  colorNameAttrs: ["ent_product_color_code"],
  categoryAttrs: ["ent_type_code"],
  genderAttrs: [],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("FLORMAR", { maxProducts: 1500, maxPages: 20, detailLimit: 0 }));
}
