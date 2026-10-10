import type { ProductRecord } from "../types";
import { listGroup, groupLimitsFromEnv, type GroupShop } from "./_ipekyolgroup";

/** Twist — İpekyol Group Next.js storefront, `outlet` sale (see _ipekyolgroup.ts). 24 per page. */
export const SHOP: GroupShop = {
  brand: "twist",
  site: "https://www.twist.com.tr",
  imageBase: "https://cdn.twist.com.tr/mnresize/750/-",
  salePath: "outlet",
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listGroup(SHOP, groupLimitsFromEnv("TWIST", { maxProducts: 2000, maxPages: 100, detailLimit: 500 }));
}
