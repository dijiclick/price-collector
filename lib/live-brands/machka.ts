import type { LiveProduct } from "../live-lookup";
import { groupUrl, type GroupLiveShop } from "./_ipekyolgroup";

/**
 * Machka by url (`machka.com.tr/urun/<routePath>`) — the İpekyol Group Next.js
 * storefront, read from the PDP's `__NEXT_DATA__` (see _ipekyolgroup.ts). The
 * id is the storefront product id, which the collector (brands/machka.ts)
 * stores from Insider's `old_group_id`.
 *
 * Caveat: the host 403s GitHub's runners (Cloudflare), so from a datacenter
 * egress this may need the proxy, exactly like Twist's resolver.
 */
export const MACHKA: GroupLiveShop = {
  brand: "machka",
  site: "https://www.machka.com.tr",
  host: "machka.com.tr",
  imageBase: "https://cdn.machka.com.tr/mnresize/750/-",
};

export async function machkaUrl(url: string): Promise<LiveProduct | null> {
  return groupUrl(MACHKA, url);
}
