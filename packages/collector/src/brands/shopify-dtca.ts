import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { SHOPIFY_DTCA } from "../../../../lib/live-brands/shopify-dtca";
import type { ShopifySite } from "../../../../lib/live-brands/shopify-sites";
import { ALL_SHOPIFY as SHOPIFY_STORES } from "../../../../lib/live-brands/shopify-all";
import { listOhPollyIe } from "./storefront-stores";
import { listShopify } from "./_shopify";
import { listStorefront } from "./_storefront";
import { STOREFRONT_DTCA } from "./storefront-dtca";

export { SHOPIFY_DTCA };

/**
 * A bundle's compare-at is the sum of its items (Betsey Johnson "BOO CREW
 * BUNDLE", Calpak "School Essentials Bundle") — a multi-buy price, not a
 * markdown. Pure.
 */
export const isBundle = (r: Pick<ProductRecord, "name" | "category">): boolean =>
  /\bbundle\b/i.test(`${r.name} ${r.category ?? ""}`);

/**
 * One registry entry per brand of package dtca: US (and Nine West CA) from
 * `/products.json`, Canada from the Storefront API when the brand's CA market
 * lives inside its US shop. A brand appears once; the market picks the route.
 *
 * Alo Yoga, Princess Polly (US/AU) and Oh Polly (GB) already have a
 * SHOPIFY_STORES row. Their entry here serves those markets from that same row
 * (sites merged, existing markets unchanged) and adds US/CA, so they must leave
 * the generic shopifyAdapters list (OWN_ENTRY in shopify-stores.ts) when this
 * is wired — otherwise a market would run twice.
 */
const allBrands = [...new Set([...SHOPIFY_DTCA, ...STOREFRONT_DTCA].map((s) => s.brand))];

/** Brands that already have a SHOPIFY_STORES row; the lead adds them to OWN_ENTRY. */
/** Every brand this module serves — the generic Shopify list leaves them out so no market runs twice. */
export const DTCA_BRANDS: readonly string[] = allBrands;
export const DTCA_OWN_ENTRY = allBrands.filter((b) => SHOPIFY_STORES.some((s) => s.brand === b));

function shopRow(brand: string): ShopifySite | undefined {
  const old = SHOPIFY_STORES.find((s) => s.brand === brand);
  const add = SHOPIFY_DTCA.find((s) => s.brand === brand);
  if (!old || !add) return old ?? add;
  return { ...old, sites: { ...add.sites, ...old.sites } };
}

export const dtcaAdapters = allBrands.map((brand) => {
  const shop = shopRow(brand);
  const sf = STOREFRONT_DTCA.find((s) => s.brand === brand);
  return {
    brand,
    listProducts: async (country: CountryCode): Promise<ProductRecord[]> => {
      // Oh Polly Ireland is its euro Market on eu.ohpolly.com (Storefront API, 2026-10-21).
      if (brand === "ohpolly" && country === "IE") return (await listOhPollyIe(country)).filter((r) => !isBundle(r));
      const rows = shop?.sites[country] ? await listShopify(shop, country) : sf?.sites[country] ? await listStorefront(sf, country) : [];
      return rows.filter((r) => !isBundle(r));
    },
  };
});
