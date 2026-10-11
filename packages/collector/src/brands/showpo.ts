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
  productUrl: (h) => `https://www.showpo.com/au/products/${h}`,
  gender: "kadin",
};

export const listShowpo = (country: CountryCode): Promise<ProductRecord[]> =>
  country === "AU" ? listSaleStore(SHOWPO, country) : Promise.resolve([]);
