import type { ProductRecord } from "../types";
import type { AkinonCatalogueLimits } from "./_akinon";
import { akinonRecords, limitsFromEnv, walkAkinonListing } from "./_akinon";
import { DIRECT_BRANDS, NON_FASHION, foldBrand, listAkinonStoreCatalogue, mapStoreProduct, type AkinonStore } from "./_akinonstore";

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
  pathAttrs: ["integration_urun_ana_grup", "integration_alt_grup", "integration_tanim"],
  exclude: [...DIRECT_BRANDS, ...NON_FASHION],
};

export const brand = STORE.shop.brand;

/**
 * FULL CATALOGUE since 2026-10-19: `/list/` (~75,000 rows, 287 brands) minus
 * the excluded brands, narrowed server-side in brand chunks that each fit
 * Akinon's 10k result window — reduced rows exactly as the `/flash-indirim/`
 * walk mapped them (same row JSON, same mapper), the rest with
 * `listPrice: null`. Any failed page, a chunk past the window, or more than
 * `maxProducts` rows THROWS (walkAkinonListing), so a partial walk never
 * reaches the collector's sold-out sweep. About 210 s of listing pages alone,
 * which does not fit a GitHub runner's 4-minute slot, so fashfed runs on our
 * own box (scripts/collector-host/modadrop-tr-full.*) with a 15-minute budget;
 * the PDP sizes pass rotates through rows without embedded sizes until
 * `budgetMs`.
 *
 * `/list/` does NOT carry every flash-sale price: some `/flash-indirim/` rows
 * are another offer of the same product (sku `200-…` vs `1024-…`) with their
 * own price and strikethrough — BESTO-TAS is 2.299 struck from 2.799 there and
 * 2.299 flat in `/list/`; 1175301-MDSD is 7.999 there, 11.999 in `/list/`
 * (9 of 1,601 deals on 10-19). So `/flash-indirim/` (~15k rows, ~65 pages) is
 * walked too and its rows win: every deal is exactly what the sale-only crawl
 * collected.
 */
export const CATALOGUE: AkinonStore = { ...STORE, shop: { ...STORE.shop, listPath: "/list/" } };

// detailLimit 1,000 (was 600, 2026-10-20): unsized rows go first now (sizes.ts),
// so ~1,000 PDPs a run clears the ~6,700 unsized deals in under a day; the
// budget below still stops the pass on a slow day.
const DEFAULTS = { maxProducts: 120_000, maxPages: 120, detailLimit: 1000 };

export function limits(): AkinonCatalogueLimits {
  return {
    ...limitsFromEnv("FASHFED", DEFAULTS),
    budgetMs: Number(process.env.FASHFED_BUDGET_MS ?? 600_000),
    concurrency: Number(process.env.FASHFED_CONCURRENCY ?? 3),
  };
}

/**
 * The catalogue with the flash-sale rows laid over it: a flash row replaces the
 * catalogue row of the same id (keeping the sizes the catalogue pass found when
 * the flash row has none); a flash-only row is added. Pure, for its test.
 */
export function overlayFlash(catalogue: ProductRecord[], flash: ProductRecord[]): ProductRecord[] {
  const byId = new Map(catalogue.map((r) => [r.externalId, r]));
  for (const f of flash) {
    const c = byId.get(f.externalId);
    byId.set(f.externalId, c && !f.variants && c.variants ? { ...f, variants: c.variants, inStock: c.inStock } : f);
  }
  return [...byId.values()];
}

export async function listProducts(): Promise<ProductRecord[]> {
  const lim = limits();
  const catalogue = await listAkinonStoreCatalogue(CATALOGUE, lim);
  const excluded = new Set(STORE.exclude.map(foldBrand));
  const walk = await walkAkinonListing(STORE.shop.site, STORE.shop.listPath, { maxPages: lim.maxPages, concurrency: lim.concurrency });
  const flash = akinonRecords(walk.rows, (p) => mapStoreProduct(STORE, p, excluded));
  return overlayFlash(catalogue, flash);
}
