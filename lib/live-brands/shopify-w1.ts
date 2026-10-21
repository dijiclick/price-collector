/**
 * Shopify storefronts re-added 2026-10-21 (package w1). Built 2026-10-11 and
 * dropped only for the then 30-per-market cap (commit 65a7a005); same rows as
 * before. Each site re-verified 2026-10-21: `/meta.json` currency = market
 * currency, `/products.json` open to a GitHub runner, real sales live.
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_W1: ShopifySite[] = [
  // United Kingdom
  { brand: "neverfullydressed", sites: { GB: "https://www.neverfullydressed.co.uk" }, defaultGender: "kadin" },
  { brand: "lounge", sites: { GB: "https://loungeunderwear.com" }, defaultGender: "kadin" },
  // Australia
  { brand: "tigerlily", sites: { AU: "https://www.tigerlily.com.au" }, defaultGender: "kadin" },
  { brand: "lovisa", sites: { AU: "https://www.lovisa.com.au" }, defaultGender: "kadin" },
  { brand: "spell", sites: { AU: "https://au.spell.co" }, defaultGender: "kadin" },
  { brand: "billini", sites: { AU: "https://www.billini.com" }, defaultGender: "kadin" },
  { brand: "seed", sites: { AU: "https://www.seedheritage.com" } },
  { brand: "wittner", sites: { AU: "https://www.wittner.com.au" }, defaultGender: "kadin" },
];
