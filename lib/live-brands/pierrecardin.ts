import type { LiveProduct } from "../live-lookup";
import { akinonUrl, type AkinonLiveShop } from "./_akinon";

export const PIERRECARDIN: AkinonLiveShop = {
  brand: "pierrecardin",
  site: "https://www.pierrecardin.com.tr",
  host: "pierrecardin.com.tr",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filterable_detail_color", "filterable_color"],
  categoryAttrs: ["filterable_product_type", "filterable_product_base_type"],
  genderAttrs: ["filterable_gender"],
};

/** Pierre Cardin TR by url (`pierrecardin.com.tr/…-50327860-vr019-1/`). See _akinon.ts. */
export async function pierrecardinUrl(url: string): Promise<LiveProduct | null> {
  return akinonUrl(PIERRECARDIN, url);
}
