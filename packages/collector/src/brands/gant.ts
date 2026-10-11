import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * GANT Turkey — Akinon (see _akinon.ts), the Lacoste/Converse attribute
 * scheme. No sale category, but the shop offers a `-discount_ratio` sorter, so
 * `/list/` sorted by it puts every reduced row first; the whole 1,801-row
 * catalogue is 19 light pages (2026-10-11). Listing rows embed per-size stock.
 */
export const SHOP: AkinonShop = {
  brand: "gant",
  site: "https://www.gant.com.tr",
  listPath: "/list/?sorter=-discount_ratio",
  sizeKey: "integration_beden",
  colorKey: "integration_renk",
  colorNameAttrs: ["filtrenebilir_renk_detay", "integration_renk_detay", "integration_renk_tonu"],
  categoryAttrs: ["integration_alt_grup", "integration_tanim"],
  genderAttrs: ["filtrenebilir_cinsiyet", "integration_erp_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("GANT", { maxProducts: 1500, maxPages: 25, detailLimit: 30 }));
}
