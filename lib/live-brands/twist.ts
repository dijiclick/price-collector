import type { LiveProduct } from "../live-lookup";
import { groupUrl, type GroupLiveShop } from "./_ipekyolgroup";

export const TWIST: GroupLiveShop = {
  brand: "twist",
  site: "https://www.twist.com.tr",
  host: "twist.com.tr",
  imageBase: "https://cdn.twist.com.tr/mnresize/750/-",
};

/** Twist by url (`twist.com.tr/urun/<routePath>`). See _ipekyolgroup.ts. */
export async function twistUrl(url: string): Promise<LiveProduct | null> {
  return groupUrl(TWIST, url);
}
