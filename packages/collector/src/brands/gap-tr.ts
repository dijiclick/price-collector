import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * GAP Turkey — Akinon (see _akinon.ts). The walk covers the whole catalogue
 * (`/list/`, 2,443 rows = 25 pages of 100, 2026-10-13) and keeps the reduced
 * rows. It used to read the sale category `/indirimli-urunler/`, but GAP
 * emptied it on 2026-10-13 (1 full-price row left) while 389 reduced rows
 * stayed elsewhere in the catalogue — and the site offers no discount sort to
 * shortcut the walk (Gant's `sorter=-discount_ratio` is not available here).
 * Listing rows
 * embed per-size stock in `extra_data.variants`; the colour group is
 * `integration_color_id` (`002`), its name `integration_color` (`Bej`).
 * Slug `gap` is shared with the other GAP markets; this file is Turkey only.
 */
export const SHOP: AkinonShop = {
  brand: "gap",
  site: "https://gap.com.tr",
  listPath: "/list/",
  sizeKey: "integration_size",
  sizeLabelAttr: "filter_size",
  colorKey: "integration_color_id",
  colorNameAttrs: ["integration_color", "integration_filter_color"],
  categoryAttrs: ["productType", "UrunGrubu"],
  genderAttrs: ["gender", "saleGroup"],
};

export const brand = SHOP.brand;

export async function listGapTr(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("GAP_TR", { maxProducts: 1500, maxPages: 30, detailLimit: 30 }));
}

export const listProducts = listGapTr;
