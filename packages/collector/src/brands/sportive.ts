import type { ProductRecord } from "../types";
import { limitsFromEnv } from "./_akinon";
import { DIRECT_BRANDS, NON_FASHION, listAkinonStoreCatalogue, type AkinonStore } from "./_akinonstore";

/**
 * Sportive — multi-brand sports retailer on Akinon. The whole `/list/`
 * catalogue is returned, reduced and full price, minus the brands we collect
 * directly (mostly Nike and Puma): 6,766 rows, narrowed server-side to the
 * other brands (adidas, Hoka, Skechers, Columbia, The North Face, Sportive's
 * own label…), ~2,900 rows in 12 pages of 250 (2026-10-19). Listing rows carry
 * colours only, so sizes come from a bounded, rotating PDP pass, reduced rows
 * first. Apparel PDPs group sizes as `integration_beden`,
 * adidas shoes as `filterable_beden`; shoe option labels under the former are
 * US codes (`8.5`), so the shopper size is read from `filterable_beden` (`42`).
 */
export const STORE: AkinonStore = {
  shop: {
    brand: "sportive",
    site: "https://www.sportive.com.tr",
    listPath: "/list/",
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
  return listAkinonStoreCatalogue(STORE, limitsFromEnv("SPORTIVE", { maxProducts: 10_000, maxPages: 40, detailLimit: 30 }));
}
