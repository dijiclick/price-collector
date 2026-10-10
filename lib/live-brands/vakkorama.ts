import type { LiveProduct } from "../live-lookup";
import { occUrl, type OccShop } from "./_sapocc";

export const VAKKORAMA: OccShop = {
  brand: "vakkorama",
  api: "https://api.vakkorama.com.tr/occ/v2/rsite",
  web: "https://www.vakkorama.com.tr",
  host: "vakkorama.com.tr",
};

/** Vakkorama by url (`vakkorama.com.tr/…-p-M405662966-0038`). See _sapocc.ts. */
export async function vakkoramaUrl(url: string): Promise<LiveProduct | null> {
  return occUrl(VAKKORAMA, url);
}
