import type { LiveProduct } from "../live-lookup";
import { akinonUrl, type AkinonLiveShop } from "./_akinon";

/** Same keys as the collector's packages/collector/src/brands/underarmour.ts. */
export const UNDERARMOUR: AkinonLiveShop = {
  brand: "underarmour",
  site: "https://www.underarmour.com.tr",
  host: "underarmour.com.tr",
  sizeKey: "integration_beden",
  colorKey: "integration_renk_detay",
  colorNameAttrs: ["integration_renk"],
  categoryAttrs: ["integration_alt_urun_grubu", "integration_ana_urun_grubu"],
  genderAttrs: ["integration_cinsiyet"],
};

/** Under Armour TR by url (`underarmour.com.tr/<slug>/`, Akinon). See _akinon.ts. */
export async function underarmourUrl(url: string): Promise<LiveProduct | null> {
  return akinonUrl(UNDERARMOUR, url);
}
