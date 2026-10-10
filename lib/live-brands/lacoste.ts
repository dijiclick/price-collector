import type { LiveProduct } from "../live-lookup";
import { akinonUrl, type AkinonLiveShop } from "./_akinon";

export const LACOSTE: AkinonLiveShop = {
  brand: "lacoste",
  site: "https://www.lacoste.com.tr",
  host: "lacoste.com.tr",
  sizeKey: "integration_beden",
  colorKey: "integration_renk",
  colorNameAttrs: ["integration_renk_detay", "integration_renk_tonu"],
  categoryAttrs: ["integration_alt_grup", "integration_tanim"],
  genderAttrs: ["integration_cinsiyet"],
};

/** Lacoste TR by url (`lacoste.com.tr/urun/…-012-2/`). See _akinon.ts. */
export async function lacosteUrl(url: string): Promise<LiveProduct | null> {
  return akinonUrl(LACOSTE, url);
}
