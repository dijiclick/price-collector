import { makeInditexAdapter } from "./_inditex";

export const brand = "pullandbear";

// Store/catalog per country come from the itxrest store list at run time; the
// Turkish pair is only the fallback for when that list cannot be read.
// The url's `?pelement={bundle id}` (the priced colour) is set in _inditex.ts —
// this file used to append `?pelement=l{ref}`, which the shop ignores.
export const listProducts = makeInditexAdapter({
  brand,
  domain: "www.pullandbear.com",
  brandId: 2,
  trFallback: { storeId: 25009521, catalogId: 20309457 }, // PULL_TURQUIA
});
