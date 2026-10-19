import type { ProductRecord } from "../types";
import { listGroupCatalogue, groupLimitsFromEnv, type GroupShop } from "./_ipekyolgroup";

/**
 * İpekyol — İpekyol Group Next.js storefront (see _ipekyolgroup.ts). 20 per page.
 *
 * FULL CATALOGUE since 2026-10-19: `koleksiyon` (the new season, 1,144 rows),
 * `outlet` (1,156) and `kozmetik` (26) are the shop's top-level trees — every
 * listing linked from the home page was checked to fall inside them. All three
 * are walked to the end (~118 pages) and every row is kept: reduced rows with
 * their strike price, the rest full price.
 */
export const SHOP: GroupShop = {
  brand: "ipekyol",
  site: "https://www.ipekyol.com.tr",
  imageBase: "https://ipekyol.sm.mncdn.com/mnresize/750/-",
  salePath: "outlet",
  cataloguePaths: ["koleksiyon", "outlet", "kozmetik"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listGroupCatalogue(SHOP, groupLimitsFromEnv("IPEKYOL", { maxProducts: 8000, maxPages: 400, detailLimit: 500 }));
}
