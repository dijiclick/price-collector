import type { LiveProduct } from "../live-lookup";
import { rndUrl, type RndLiveShop } from "./_rnd";

/**
 * Levi's Turkey by url (`levis.com.tr/<slug>_<id>`, RND Commerce; see _rnd.ts).
 * Only the Turkish store: levi.com (US/CA) is Akamai-walled for page reads,
 * and `levi.com` does not contain the slug, so brandFromUrl never routes it here.
 */
export const LEVIS_TR: RndLiveShop = { brand: "levis", site: "https://www.levis.com.tr", host: "levis.com.tr" };

export async function levisUrl(url: string): Promise<LiveProduct | null> {
  return rndUrl(LEVIS_TR, url);
}
