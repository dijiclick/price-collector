/**
 * Hello Molly (hellomolly.com.au / hellomolly.com) — Australian young-women's
 * occasion-wear label, Australia + US. The headless storefront on Vercel
 * answers bots with `x-vercel-mitigated` (429/deny), but the Shopify shops
 * behind it are open on their myshopify hosts: `hellomollyfashion` ("Hello
 * Molly AU", AUD) and `hellomollyfashion-usa` ("Hello Molly US", USD), per
 * their `/meta.json`. The "sale" collection (~2,950 AU products) is read there.
 * Verified from a GitHub runner, probe run 38134417285, no proxy.
 */
import type { ProductRecord } from "../types";
import type { CountryCode } from "../../../../lib/countries";
import { listShopifyCollection, type CollectionShop } from "./_shopifycollection";

export const HELLOMOLLY: Partial<Record<CountryCode, CollectionShop>> = {
  AU: {
    brand: "hellomolly",
    apiOrigin: "https://hellomollyfashion.myshopify.com",
    site: "https://www.hellomolly.com.au",
    collection: "sale",
    gender: "kadin",
  },
  US: {
    brand: "hellomolly",
    apiOrigin: "https://hellomollyfashion-usa.myshopify.com",
    site: "https://www.hellomolly.com",
    collection: "sale",
    gender: "kadin",
  },
};

export const listHelloMolly = (country: CountryCode): Promise<ProductRecord[]> => {
  const shop = HELLOMOLLY[country];
  return shop ? listShopifyCollection(shop, country) : Promise.resolve([]);
};

export const listProducts = listHelloMolly;
