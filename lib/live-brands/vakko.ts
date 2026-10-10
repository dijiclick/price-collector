import type { LiveProduct } from "../live-lookup";
import { occUrl, type OccShop } from "./_sapocc";

export const VAKKO: OccShop = {
  brand: "vakko",
  api: "https://api.vakko.com/occ/v2/vsite",
  web: "https://www.vakko.com",
  host: "vakko.com",
};

/** Vakko by url (`vakko.com/…-p-M404335682-0037`). See _sapocc.ts. */
export async function vakkoUrl(url: string): Promise<LiveProduct | null> {
  return occUrl(VAKKO, url);
}
