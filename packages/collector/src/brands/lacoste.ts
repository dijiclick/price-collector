import type { ProductRecord } from "../types";
import { listAkinon, limitsFromEnv, type AkinonShop } from "./_akinon";

/**
 * Lacoste Turkey — Akinon (see _akinon.ts). There is no sale category, so the
 * whole `/list/` catalogue (~3,200 colour rows, 33 pages, ~8 s) is walked and
 * the discounted rows kept (1,315 on 2026-10-10, a flat 25% season sale; on
 * 10-16 the sale was over and one row of 2,018 was reduced, so the walk returns
 * the catalogue — see MIN_SALE_ROWS in _akinon.ts). The
 * listing carries colours only, so sizes come from the PDP pass; Lacoste's
 * size option labels are codes (`T65`), the real size is the option product's
 * `filterable_size` (`40`).
 */
export const SHOP: AkinonShop = {
  brand: "lacoste",
  site: "https://www.lacoste.com.tr",
  listPath: "/list/",
  sizeKey: "integration_beden",
  sizeLabelAttr: "filterable_size",
  colorKey: "integration_renk",
  colorNameAttrs: ["integration_renk_detay", "integration_renk_tonu"],
  categoryAttrs: ["integration_alt_grup", "integration_tanim"],
  genderAttrs: ["integration_cinsiyet"],
};

export const brand = SHOP.brand;

export async function listProducts(): Promise<ProductRecord[]> {
  return listAkinon(SHOP, limitsFromEnv("LACOSTE", { maxProducts: 2000, maxPages: 40, detailLimit: 1500 }));
}
