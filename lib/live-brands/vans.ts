import type { LiveProduct } from "../live-lookup";
import { rndUrl, type RndLiveShop } from "./_rnd";

/** Vans Turkey by url (`vans.com.tr/<slug>_<id>`, RND Commerce; see _rnd.ts). Other markets' hosts answer null. */
export const VANS_TR: RndLiveShop = { brand: "vans", site: "https://www.vans.com.tr", host: "vans.com.tr" };

export async function vansUrl(url: string): Promise<LiveProduct | null> {
  return rndUrl(VANS_TR, url);
}
