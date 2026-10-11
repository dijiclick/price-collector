/**
 * MESHKI (meshki.com.au / meshki.us) — Australian women's label, Australia + US.
 * www.meshki.com.au and www.meshki.us sit behind a Cloudflare JS challenge
 * (Shopify bot protection), but the shops' own myshopify hosts answer:
 * `meshki-clothing` ("MESHKI", AUD) and `meshki-us` ("MESHKI US", USD), per
 * their `/meta.json`. The "sale" collection (~6,100 AU products) is read there,
 * stopping once the cap is filled with in-stock rows (~7 pages).
 * Verified from a GitHub runner, probe run 38134417285, no proxy.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listShopifyCollection, type CollectionShop } from "./_shopifycollection";

export const MESHKI: Partial<Record<CountryCode, CollectionShop>> = {
  AU: {
    brand: "meshki",
    apiOrigin: "https://meshki-clothing.myshopify.com",
    site: "https://www.meshki.com.au",
    collection: "sale",
    gender: "kadin",
  },
  US: {
    brand: "meshki",
    apiOrigin: "https://meshki-us.myshopify.com",
    site: "https://www.meshki.us",
    collection: "sale",
    gender: "kadin",
  },
};

export const listMeshki = (country: CountryCode): Promise<ProductRecord[]> => {
  const shop = MESHKI[country];
  return shop ? listShopifyCollection(shop, country) : Promise.resolve([]);
};

export const listProducts = listMeshki;
