import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * GANT Turkey — Akinon (see _akinon.ts), the Lacoste/Converse attribute
 * scheme. The whole `/list/` catalogue is returned, reduced and full price
 * (1,427 rows = 6 pages of 250, 2026-10-19), so the `-discount_ratio` sort the
 * sale-only walk used is no longer needed. Listing rows embed per-size stock.
 */
export const SHOP: AkinonShop = {
  brand: "gant",
  site: "https://www.gant.com.tr",
  listPath: "/list/",
  sizeKey: "integration_beden",
  colorKey: "integration_renk",
  colorNameAttrs: ["filtrenebilir_renk_detay", "integration_renk_detay", "integration_renk_tonu"],
  categoryAttrs: ["integration_alt_grup", "integration_tanim"],
  genderAttrs: ["filtrenebilir_cinsiyet", "integration_erp_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("GANT", { maxProducts: 6_000, maxPages: 25, detailLimit: 30 }));
}
