import type { ProductRecord } from "../types";
import { listGroup, groupLimitsFromEnv, type GroupShop } from "./_ipekyolgroup";

/** İpekyol — İpekyol Group Next.js storefront, `outlet` sale (see _ipekyolgroup.ts). 20 per page. */
export const SHOP: GroupShop = {
  brand: "ipekyol",
  site: "https://www.ipekyol.com.tr",
  imageBase: "https://ipekyol.sm.mncdn.com/mnresize/750/-",
  salePath: "outlet",
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listGroup(SHOP, groupLimitsFromEnv("IPEKYOL", { maxProducts: 2000, maxPages: 100, detailLimit: 500 }));
}
