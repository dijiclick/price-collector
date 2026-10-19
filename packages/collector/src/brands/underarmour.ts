import type { ProductRecord } from "../types";
import { listAkinonCatalogue, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Under Armour Turkey — www.underarmour.com.tr, Akinon (`static_omnishop`, see
 * _akinon.ts). The whole `/list/` catalogue is returned, reduced and full
 * price (4,103 rows = 17 pages of 250, 2026-10-19; its 864 reduced rows are
 * exactly the `/outlet/` sale category, at the same prices).
 *
 * Each listing row is one size SKU of a colour and lists only the colour group
 * (`integration_renk_detay`), so sizes (`integration_beden`) come from the PDP
 * pass, reduced rows first (300 per run, rotating). The colour key is
 * `integration_renk_detay` ("Black /  / Black"), not `integration_renk`: the plain colour name repeats within a model (two "Gri"
 * colourways of one jacket), the detail colour never did (874 of 874 unique).
 * `integration_cinsiyet` is "Erkek" / "Kadın" / "Erkek Çocuk" / "Kız Çocuk" /
 * "Unisex" — child first in genderOf.
 */
export const SHOP: AkinonShop = {
  brand: "underarmour",
  site: "https://www.underarmour.com.tr",
  listPath: "/list/",
  sizeKey: "integration_beden",
  colorKey: "integration_renk_detay",
  colorNameAttrs: ["integration_renk"],
  categoryAttrs: ["integration_alt_urun_grubu", "integration_ana_urun_grubu"],
  genderAttrs: ["integration_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonCatalogue(SHOP, limitsFromEnv("UNDERARMOUR", { maxProducts: 12_000, maxPages: 40, detailLimit: 300 }));
}
