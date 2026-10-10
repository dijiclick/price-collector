import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Marks & Spencer Turkey — Akinon (see _akinon.ts). `/tum-indirim/` is the
 * sale category (~4,000 rows, every one reduced, 2026-10-10). Listing rows
 * embed per-size stock in `extra_data.variants`; `filter_size1` is the
 * Turkish size label (`3-4 Yaş`) where the option label is the ERP one (`3-4 Y`).
 * Pages are heavy (~4 MB per 100), hence the 2,000 cap at 20 pages.
 */
export const SHOP: AkinonShop = {
  brand: "marksandspencer",
  site: "https://www.marksandspencer.com.tr",
  listPath: "/tum-indirim/",
  sizeKey: "integration_size",
  sizeLabelAttr: "filter_size1",
  colorKey: "integration_color",
  colorNameAttrs: ["filter_color1"],
  categoryAttrs: ["filterable_category"],
  genderAttrs: ["gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("MARKSANDSPENCER", { maxProducts: 2000, maxPages: 40, detailLimit: 300 }));
}
