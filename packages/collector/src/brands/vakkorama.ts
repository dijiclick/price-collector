import type { ProductRecord } from "../types";
import { makeOccAdapter } from "./_sapocc";

// Vakkorama — same SAP Commerce OCC v2 backend as Vakko, site `rsite` on its own
// API host. Multi-brand; the sale lives in the Outlet tree (category 203, ~6k
// items, about two thirds with a strike price — the rest are dropped).
export const brand = "vakkorama";

const list = makeOccAdapter(
  { brand, api: "https://api.vakkorama.com.tr/occ/v2/rsite", web: "https://www.vakkorama.com.tr", saleCategory: "203" },
  { maxProducts: Number(process.env.VAKKORAMA_MAX_PRODUCTS ?? 2000) },
);

export async function listProducts(): Promise<ProductRecord[]> {
  return list();
}
