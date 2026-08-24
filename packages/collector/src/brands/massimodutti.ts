import { makeInditexAdapter } from "./_inditex";

export const brand = "massimodutti";

export const listProducts = makeInditexAdapter({
  brand,
  domain: "www.massimodutti.com",
  storeId: "34009471",
  catalogId: "30359503", // MD_TURQUIA, per /itxrest/2/catalog/store/34009471
});
