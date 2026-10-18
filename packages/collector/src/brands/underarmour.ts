import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Under Armour Turkey — www.underarmour.com.tr, Akinon (`static_omnishop`, see
 * _akinon.ts). `/outlet/` is the whole sale: 874 rows on 2026-10-18, exactly
 * the reduced rows of the full 4,124-row `/list/` walk. 9 pages of 100.
 *
 * Each listing row is one size SKU of a colour and lists only the colour group
 * (`integration_renk_detay`), so sizes (`integration_beden`) come from the PDP
 * pass. The colour key is `integration_renk_detay` ("Black /  / Black"), not
 * `integration_renk`: the plain colour name repeats within a model (two "Gri"
 * colourways of one jacket), the detail colour never did (874 of 874 unique).
 * `integration_cinsiyet` is "Erkek" / "Kadın" / "Erkek Çocuk" / "Kız Çocuk" /
 * "Unisex" — child first in genderOf.
 */
export const SHOP: AkinonShop = {
  brand: "underarmour",
  site: "https://www.underarmour.com.tr",
  listPath: "/outlet/",
  sizeKey: "integration_beden",
  colorKey: "integration_renk_detay",
  colorNameAttrs: ["integration_renk"],
  categoryAttrs: ["integration_alt_urun_grubu", "integration_ana_urun_grubu"],
  genderAttrs: ["integration_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("UNDERARMOUR", { maxProducts: 1500, maxPages: 15, detailLimit: 300 }));
}
