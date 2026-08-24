import type { ProductRecord } from "../types";
import { makeInditexAdapter } from "./_inditex";

export const brand = "pullandbear";

const inditexList = makeInditexAdapter({
  brand,
  domain: "www.pullandbear.com",
  storeId: "25009521",
  catalogId: "20309457",
});

export async function listProducts(): Promise<ProductRecord[]> {
  const records = await inditexList();
  // A Pull&Bear slug (l-code) can be shared by several colourway products with
  // different prices; ?pelement pins the page to the product we priced.
  for (const r of records) {
    if (!r.url.includes("?")) r.url += `?pelement=${r.externalId}`;
  }
  return records;
}
