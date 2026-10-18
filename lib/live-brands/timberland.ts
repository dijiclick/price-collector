import type { LiveProduct } from "../live-lookup";
import { rndUrl, type RndLiveShop } from "./_rnd";

/** Timberland Turkey by url (`timberland.com.tr/<slug>-p_<id>`, RND Commerce; see _rnd.ts). */
export const TIMBERLAND: RndLiveShop = { brand: "timberland", site: "https://www.timberland.com.tr", host: "timberland.com.tr" };

export async function timberlandUrl(url: string): Promise<LiveProduct | null> {
  return rndUrl(TIMBERLAND, url);
}
