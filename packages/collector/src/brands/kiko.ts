import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * KIKO Milano Turkey — www.kikomilano.com.tr (NOT kikocosmetics.com/tr-tr,
 * which is a 404: Turkey is a franchise on its own Akinon store). Akinon
 * listing JSON (see _akinon.ts), answers a GitHub runner directly (probe run
 * 38136052355).
 *
 * The whole `/list/` catalogue is returned, reduced and full price (2,250
 * shade rows = 9 pages of 250, 2026-10-19). Reduced shades are mostly
 * end-of-line, kept so a restock of one raises an alert. Each row is one
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
  const rows = await listAkinonCatalogue(SHOP, limitsFromEnv("KIKO", { maxProducts: 7_000, maxPages: 30, detailLimit: 0 }));
  for (const r of rows) {
    r.gender = null; // cosmetics: no section
    if (r.category) r.category = r.category.toLocaleLowerCase("tr").replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase("tr"));
  }
  return [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)];
}
