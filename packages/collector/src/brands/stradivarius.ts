import { makeInditexAdapter } from "./_inditex";

export const brand = "stradivarius";

export const listProducts = makeInditexAdapter({
  brand,
  domain: "www.stradivarius.com",
  storeId: "54009571",
  catalogId: "50331068",
});
