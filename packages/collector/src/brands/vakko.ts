import type { ProductRecord } from "../types";
import { makeOccAdapter } from "./_sapocc";

// Vakko — SAP Commerce OCC v2, site `vsite`. The sale lives in the Outlet tree
// (category 312, ~12k items, ~95% with a strike price); see _sapocc.ts.
export const brand = "vakko";

const list = makeOccAdapter(
  { brand, api: "https://api.vakko.com/occ/v2/vsite", web: "https://www.vakko.com", saleCategory: "312" },
  { maxProducts: Number(process.env.VAKKO_MAX_PRODUCTS ?? 2000) },
);

/** TR only: Vakko's EUR sites (vsite_eu/vsite_gr) are not collected. */
export async function listProducts(): Promise<ProductRecord[]> {
  return list();
}
