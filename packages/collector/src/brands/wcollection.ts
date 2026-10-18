import type { ProductRecord } from "../types";
import { makeOccAdapter, type OccSite } from "./_sapocc";

/**
 * W Collection TR (Vakko group) — SAP Commerce OCC v2 on the group's own API
 * host, site `wsite`, the same shape as Vakko/Vakkorama (_sapocc.ts). Built
 * 2026-10-18.
 *
 * The sale is the OUTLET tree (category 103: 2,626 items, ~99% with a
 * `firstStrikePrice`; gender facet Erkek 2,090 / Kadın 536). The shared adapter
 * splits it by that facet, so every record gets an exact gender and the cap is
 * shared in proportion. `api.wcollection.com.tr` answers a GitHub runner with
 * 200 (probe run 39124308073). Per-size stock, EANs and the gallery come with
 * each search hit.
 */
export const SITE: OccSite = {
  brand: "wcollection",
  api: "https://api.wcollection.com.tr/occ/v2/wsite",
  web: "https://www.wcollection.com.tr",
  saleCategory: "103",
};

export const brand = SITE.brand;

const list = makeOccAdapter(SITE, { maxProducts: Number(process.env.WCOLLECTION_MAX_PRODUCTS ?? 1500) });

export async function listProducts(): Promise<ProductRecord[]> {
  return list();
}
