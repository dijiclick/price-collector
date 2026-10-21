/**
 * Showpo (showpo.com) — Australian women's fashion, Shopify Hydrogen. Its
 * `/products.json` is a 404 (headless front), so the sale collection is read
 * through the Storefront API of the AU/NZ store with the public token the site
 * ships in every page (`storefrontAccessToken`). `@inContext(country: AU)`
 * prices it in AUD. Measured 2026-10-11: "sale" ≈ 1,630 reduced products,
 * ~1,310 of them in stock, per-size stock on every variant.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listSaleStore, type SaleStore } from "./_storefrontsale";

export const SHOWPO: SaleStore = {
  brand: "showpo",
  apiHost: "showpo-aunz-prod.myshopify.com",
  token: process.env.SHOWPO_STOREFRONT_TOKEN ?? "24fbff5d48c32731464d09638f463c42",
  tokenPage: "https://www.showpo.com/row/",
  collections: ["sale"],
  productUrl: (h) => `https://www.showpo.com/products/${h}`, // /au/products/… 404s (2026-10-21)
  gender: "kadin",
};

/**
 * US + Canada (2026-10-21): showpo.com/us and /ca are a second Shopify store,
 * `showpo-uscadrow-prod` (US/CA/rest of world), with its own public token in
 * the /us/ page HTML. `@inContext(country: US|CA)` prices it in USD / CAD;
 * same "sale" collection with compare-at prices.
 */
export const SHOWPO_NA: Partial<Record<CountryCode, SaleStore>> = Object.fromEntries(
  (["US", "CA"] as const).map((cc) => [
    cc,
    {
      ...SHOWPO,
      apiHost: "showpo-uscadrow-prod.myshopify.com",
      token: process.env.SHOWPO_NA_STOREFRONT_TOKEN ?? "a43d30fe3356833cfa5eb14f16717aca",
      tokenPage: `https://www.showpo.com/${cc.toLowerCase()}/`,
      productUrl: (h: string) => `https://www.showpo.com/${cc.toLowerCase()}/products/${h}`,
    },
  ]),
);

export const listShowpo = (country: CountryCode): Promise<ProductRecord[]> =>
  country === "AU"
    ? listSaleStore(SHOWPO, country)
    : SHOWPO_NA[country]
      ? listSaleStore(SHOWPO_NA[country]!, country)
      : Promise.resolve([]);
