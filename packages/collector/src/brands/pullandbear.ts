import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { makeInditexAdapter } from "./_inditex";

export const brand = "pullandbear";

// Store/catalog per country come from the itxrest store list at run time; the
// Turkish pair is only the fallback for when that list cannot be read.
const inditexList = makeInditexAdapter({
  brand,
  domain: "www.pullandbear.com",
  brandId: 2,
  trFallback: { storeId: 25009521, catalogId: 20309457 }, // PULL_TURQUIA
});

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  const records = await inditexList(country);
  // A Pull&Bear slug (l-code) can be shared by several colourway products with
  // different prices; ?pelement pins the page to the product we priced.
  for (const r of records) {
    if (!r.url.includes("?")) r.url += `?pelement=${r.externalId}`;
  }
  return records;
}
