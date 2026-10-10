import type { LiveProduct } from "../live-lookup";
import { akinonUrl, type AkinonLiveShop } from "./_akinon";

export const MARKSANDSPENCER: AkinonLiveShop = {
  brand: "marksandspencer",
  site: "https://www.marksandspencer.com.tr",
  host: "marksandspencer.com.tr",
  sizeKey: "integration_size",
  colorKey: "integration_color",
  colorNameAttrs: ["filter_color1"],
  categoryAttrs: ["filterable_category"],
  genderAttrs: ["gender"],
};

/** Marks & Spencer TR by url (`marksandspencer.com.tr/kadin-…-10000000980295/`). See _akinon.ts. */
export async function marksandspencerUrl(url: string): Promise<LiveProduct | null> {
  return akinonUrl(MARKSANDSPENCER, url);
}
