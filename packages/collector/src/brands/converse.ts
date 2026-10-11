import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Converse Turkey — Akinon (see _akinon.ts), the Lacoste/GANT attribute scheme
 * (`integration_renk` / `integration_beden`). `/sezon-indirimi/` is the sale
 * category (556 rows, all reduced, 6 pages, 2026-10-11). Listing rows embed
 * per-size stock; option labels are already shopper sizes (`36,5`).
 */
export const SHOP: AkinonShop = {
  brand: "converse",
  site: "https://www.converse.com.tr",
  listPath: "/sezon-indirimi/",
  sizeKey: "integration_beden",
  colorKey: "integration_renk",
  colorNameAttrs: ["integration_renk_detay", "integration_renk_tonu"],
  categoryAttrs: ["integration_alt_grup", "integration_tanim"],
  genderAttrs: ["cinsiyet_", "integration_erp_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("CONVERSE", { maxProducts: 1500, maxPages: 15, detailLimit: 30 }));
}
