import type { LiveProduct } from "../live-lookup";
import { occUrl, type OccShop } from "./_sapocc";

export const WCOLLECTION: OccShop = {
  brand: "wcollection",
  api: "https://api.wcollection.com.tr/occ/v2/wsite",
  web: "https://www.wcollection.com.tr",
  host: "wcollection.com.tr",
};

/** W Collection by url (`wcollection.com.tr/…-p-M405273682-0021`). See _sapocc.ts. */
export async function wcollectionUrl(url: string): Promise<LiveProduct | null> {
  return occUrl(WCOLLECTION, url);
}
