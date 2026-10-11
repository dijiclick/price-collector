/**
 * Lorna Jane (lornajane.com.au) — AU activewear. Collected through the generic
 * Shopify feed until 2026-10-11, when Cloudflare started answering
 * `/products.json` (and collection JSON) with a 429 challenge on GitHub
 * runners. The Storefront API on the shop's myshopify host is not behind that
 * challenge (probe run 38155551042), so the "sale" collection is read there
 * with the public token the site ships in its HTML.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listSaleStore, type SaleStore } from "./_storefrontsale";

export const LORNAJANE: SaleStore = {
  brand: "lornajane",
  apiHost: "lornajane-au-prod.myshopify.com",
  token: process.env.LORNAJANE_STOREFRONT_TOKEN ?? "cf0bda975a1d9d7d27fa98392a451d04",
  tokenPage: "https://www.lornajane.com.au/",
  collections: ["sale"],
  productUrl: (h) => `https://www.lornajane.com.au/products/${h}`,
  gender: "kadin",
};

export const listLornaJane = (country: CountryCode): Promise<ProductRecord[]> =>
  country === "AU" ? listSaleStore(LORNAJANE, country) : Promise.resolve([]);
