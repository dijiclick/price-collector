import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Marks & Spencer Turkey — Akinon (see _akinon.ts). The whole `/list/`
 * catalogue is returned, reduced and full price (8,499 rows = 34 pages of 250,
 * ~9 MB each, ~40 s, 2026-10-19; the `/tum-indirim/` sale category's 4,303
 * rows are in it at the same prices). Listing rows embed per-size stock in
 * `extra_data.variants`; `filter_size1` is the Turkish size label (`3-4 Yaş`)
 * where the option label is the ERP one (`3-4 Y`). Past 10,000 rows the walk
 * switches to the two price-sorted halves (see walkAkinonListing).
 */
export const SHOP: AkinonShop = {
  brand: "marksandspencer",
  site: "https://www.marksandspencer.com.tr",
  listPath: "/list/",
  sizeKey: "integration_size",
  sizeLabelAttr: "filter_size1",
  colorKey: "integration_color",
  colorNameAttrs: ["filter_color1"],
  categoryAttrs: ["filterable_category"],
  genderAttrs: ["gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("MARKSANDSPENCER", { maxProducts: 20_000, maxPages: 82, detailLimit: 300 }));
}
