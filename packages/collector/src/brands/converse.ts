import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Converse Turkey — Akinon (see _akinon.ts), the Lacoste/GANT attribute scheme
 * (`integration_renk` / `integration_beden`). The whole `/list/` catalogue is
 * returned, reduced and full price (1,202 rows = 5 pages of 250, 2026-10-19;
 * every row of the `/sezon-indirimi/` sale category is in it at the same
 * price). Listing rows embed per-size stock; option labels are already
 * shopper sizes (`36,5`).
 */
export const SHOP: AkinonShop = {
  brand: "converse",
  site: "https://www.converse.com.tr",
  listPath: "/list/",
  sizeKey: "integration_beden",
  colorKey: "integration_renk",
  colorNameAttrs: ["integration_renk_detay", "integration_renk_tonu"],
  categoryAttrs: ["integration_alt_grup", "integration_tanim"],
  genderAttrs: ["cinsiyet_", "integration_erp_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("CONVERSE", { maxProducts: 5_000, maxPages: 20, detailLimit: 30 }));
}
