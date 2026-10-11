import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * GAP Turkey — Akinon (see _akinon.ts). `/indirimli-urunler/` is the sale
 * category (1,235 rows, every one reduced, 13 pages, 2026-10-11). Listing rows
 * embed per-size stock in `extra_data.variants`; the colour group is
 * `integration_color_id` (`002`), its name `integration_color` (`Bej`).
 * Slug `gap` is shared with the other GAP markets; this file is Turkey only.
 */
export const SHOP: AkinonShop = {
  brand: "gap",
  site: "https://gap.com.tr",
  listPath: "/indirimli-urunler/",
  sizeKey: "integration_size",
  sizeLabelAttr: "filter_size",
  colorKey: "integration_color_id",
  colorNameAttrs: ["integration_color", "integration_filter_color"],
  categoryAttrs: ["productType", "UrunGrubu"],
  genderAttrs: ["gender", "saleGroup"],
};

export const brand = SHOP.brand;

export async function listGapTr(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("GAP_TR", { maxProducts: 1500, maxPages: 20, detailLimit: 30 }));
}

export const listProducts = listGapTr;
