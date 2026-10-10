import type { LiveProduct } from "../live-lookup";
import { groupUrl, type GroupLiveShop } from "./_ipekyolgroup";

export const IPEKYOL: GroupLiveShop = {
  brand: "ipekyol",
  site: "https://www.ipekyol.com.tr",
  host: "ipekyol.com.tr",
  imageBase: "https://ipekyol.sm.mncdn.com/mnresize/750/-",
};

/** İpekyol by url (`ipekyol.com.tr/urun/<routePath>`). See _ipekyolgroup.ts. */
export async function ipekyolUrl(url: string): Promise<LiveProduct | null> {
  return groupUrl(IPEKYOL, url);
}
