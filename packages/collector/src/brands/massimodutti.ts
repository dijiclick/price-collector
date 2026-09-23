import { makeInditexAdapter } from "./_inditex";

export const brand = "massimodutti";

// Store/catalog per country come from the itxrest store list at run time; the
// Turkish pair is only the fallback for when that list cannot be read.
export const listProducts = makeInditexAdapter({
  brand,
  domain: "www.massimodutti.com",
  brandId: 3,
  trFallback: { storeId: 34009471, catalogId: 30359503 }, // MD_TURQUIA
});
