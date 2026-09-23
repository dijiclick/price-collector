import { makeInditexAdapter } from "./_inditex";

export const brand = "stradivarius";

// Store/catalog per country come from the itxrest store list at run time; the
// Turkish pair is only the fallback for when that list cannot be read.
export const listProducts = makeInditexAdapter({
  brand,
  domain: "www.stradivarius.com",
  brandId: 5,
  trFallback: { storeId: 54009571, catalogId: 50331068 }, // STR_TURQUIA_INVIERNO
});
