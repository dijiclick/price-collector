import type { ProductRecord } from "../types";
import { limitsFromEnv } from "./_akinon";
import { DIRECT_BRANDS, NON_FASHION, listAkinonStore, type AkinonStore } from "./_akinonstore";

/**
 * Sportive — multi-brand sports retailer on Akinon. `/outlet/` is the sale
 * category (~3,500 rows, all reduced, 2026-10-11), mostly Nike and Puma, which
 * we collect directly; the walk is narrowed server-side to the other brands
 * (adidas, Hoka, Skechers, Columbia, The North Face, Sportive's own label…),
 * ~1,600 rows in 16 pages. Listing rows carry colours only, so sizes come from
 * a bounded, rotating PDP pass. Apparel PDPs group sizes as `integration_beden`,
 * adidas shoes as `filterable_beden`; shoe option labels under the former are
 * US codes (`8.5`), so the shopper size is read from `filterable_beden` (`42`).
 */
export const STORE: AkinonStore = {
  shop: {
    brand: "sportive",
    site: "https://www.sportive.com.tr",
    listPath: "/outlet/",
    sizeKey: "integration_beden",
    sizeLabelAttr: "filterable_beden",
    colorKey: "integration_renk",
    colorNameAttrs: ["filterable_renk"],
    categoryAttrs: ["integration_urun_altgrup", "integration_urun_grup"],
    genderAttrs: ["integration_cinsiyet"],
  },
  brandAttr: "integration_marka",
  exclude: [...DIRECT_BRANDS, ...NON_FASHION],
  serverFilter: true,
  altSizeKeys: ["filterable_beden"],
};

export const brand = STORE.shop.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonStore(STORE, limitsFromEnv("SPORTIVE", { maxProducts: 1500, maxPages: 25, detailLimit: 30 }));
}
