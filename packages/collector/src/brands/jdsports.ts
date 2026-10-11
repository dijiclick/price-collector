/**
 * JD Sports Australia (jd-sports.com.au) — Shopify, but Cloudflare answers 403
 * to `/products*` for non-browsers. The Storefront API on the shop's own
 * `myshopify.com` host is open with the public token from the home page HTML.
 * Women's sale only (`offers-women`, ≈3,500 products, ~560 in stock on
 * 2026-10-11): in-stock rows first, then sold-out ones up to the cap, since
 * those are what a size restock alert needs.
 *
 * Slug is "jd-sports" because it must be a substring of the host.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listSaleStore, type SaleStore } from "./_storefrontsale";

export const JD_SPORTS_AU: SaleStore = {
  brand: "jd-sports",
  apiHost: "35a1e3-65.myshopify.com",
  token: process.env.JDSPORTS_AU_STOREFRONT_TOKEN ?? "a5dfcfa08fd543458cd02b6bbd4aacf5",
  tokenPage: "https://www.jd-sports.com.au/",
  collections: ["offers-women"],
  productUrl: (h) => `https://www.jd-sports.com.au/products/${h}`,
  gender: "kadin",
  vendorInName: true,
};

export const listJdSports = (country: CountryCode): Promise<ProductRecord[]> =>
  country === "AU" ? listSaleStore(JD_SPORTS_AU, country) : Promise.resolve([]);
