import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Pierre Cardin Turkey — Akinon (see _akinon.ts). The whole `/list/`
 * catalogue is returned, reduced and full price (7,540 rows = 31 pages of 250,
 * 2026-10-19). Listing rows embed per-size stock in `extra_data.variants`, so
 * no PDP calls are needed. Past 10,000 rows the walk switches to the two
 * price-sorted halves (see walkAkinonListing).
 */
export const SHOP: AkinonShop = {
  brand: "pierrecardin",
  site: "https://www.pierrecardin.com.tr",
  listPath: "/list/",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filterable_detail_color", "filterable_color"],
  categoryAttrs: ["filterable_product_type", "filterable_product_base_type"],
  genderAttrs: ["filterable_gender"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("PIERRECARDIN", { maxProducts: 20_000, maxPages: 82, detailLimit: 300 }));
}
