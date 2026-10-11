import type { ProductRecord } from "../types";
import type { AkinonLimits } from "./_akinon";
import { limitsFromEnv } from "./_akinon";
import { DIRECT_BRANDS, NON_FASHION, listAkinonStore, type AkinonStore } from "./_akinonstore";

/**
 * FashFed — the Beymen group's multi-brand Akinon marketplace (287 brands,
 * ~80,000 rows). `/flash-indirim/` is its sale category (~15,400 rows, ~2/3
 * reduced). Brands we collect from their own sites are dropped client-side
 * (see _akinonstore.ts). In the default order about half the kept rows embed
 * per-size stock; the rest get sizes from a bounded, rotating PDP pass. (The
 * shop's `-discount_ratio` sorter was tried and rejected: its top rows are
 * marketplace-seller items with no embedded sizes — 0 of 268 vs 740 of 1,399.)
 */
export const STORE: AkinonStore = {
  shop: {
    brand: "fashfed",
    site: "https://www.fashfed.com",
    listPath: "/flash-indirim/",
    sizeKey: "integration_beden",
    sizeLabelAttr: "filterable_size",
    colorKey: "integration_renk",
    colorNameAttrs: ["integration_renk_detay", "integration_renk_tonu"],
    categoryAttrs: ["integration_alt_grup", "integration_tanim"],
    genderAttrs: ["integration_cinsiyet", "integration_erp_cinsiyet"],
  },
  brandAttr: "integration_marka",
  exclude: [...DIRECT_BRANDS, ...NON_FASHION],
};

export const brand = STORE.shop.brand;

export const LIMITS: AkinonLimits = { maxProducts: 1500, maxPages: 35, detailLimit: 20 };

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinonStore(STORE, limitsFromEnv("FASHFED", LIMITS));
}
