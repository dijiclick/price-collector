import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * KIKO Milano Turkey — www.kikomilano.com.tr (NOT kikocosmetics.com/tr-tr,
 * which is a 404: Turkey is a franchise on its own Akinon store). Akinon
 * listing JSON (see _akinon.ts), answers a GitHub runner directly (probe run
 * 38136052355).
 *
 * No sale category and the "indirim" sorter does not actually sort, so the
 * whole `/list/` catalogue is walked (2,247 shade rows, 23 pages, 2026-10-11)
 * and the reduced rows kept — 768, of which ~110 in stock: discounted shades are
 * mostly end-of-line, kept so a restock of one raises an alert. Each row is one
 * shade: the id is `<base_code>-<shade>` (shades of one product share
 * `base_code`, which becomes the groupKey). Cosmetics carry no sizes, so no PDP pass.
 */
export const SHOP: AkinonShop = {
  brand: "kiko",
  site: "https://www.kikomilano.com.tr",
  listPath: "/list/",
  sizeKey: "integration_beden",
  colorKey: "color",
  colorNameAttrs: ["color", "filterable_main_color"],
  categoryAttrs: ["GoogleProductType"],
  genderAttrs: [],
};

export const brand = SHOP.brand;

export async function listProducts(_country: CountryCode = "TR"): Promise<ProductRecord[]> {
  const rows = await listAkinon(SHOP, limitsFromEnv("KIKO", { maxProducts: 1500, maxPages: 30, detailLimit: 0 }));
  for (const r of rows) {
    r.gender = null; // cosmetics: no section
    if (r.category) r.category = r.category.toLocaleLowerCase("tr").replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase("tr"));
  }
  return [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)];
}
