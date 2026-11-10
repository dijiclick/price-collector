/**
 * Shopify storefronts added 2026-11-10 (Germany / France round). Each answered
 * a GitHub runner (probe run 42810180291, no proxy) with `/meta.json` in EUR
 * and an open `/products.json` carrying real compare-at prices on a minority
 * of the catalogue (sampled pages 1, 6 and 14 of 30):
 * Görtz 23 of 60 reduced (229 products — the relaunched shop is small),
 * Jack Wolfskin 14 of 90 (2,046), Snocks 7 of 90 (619), Purelei 22 of 90
 * (1,087), Paul Valentine 18 of 71 (401), Le Coq Sportif 16 of 60 (1,910),
 * André 37 of 90 (2,144).
 * Left out the same day: Oceansapart (22 of 30 "reduced", a standing 20%),
 * Naketano and Salamander (a handful of rows), Armedangels (none).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_EU2: ShopifySite[] = [
  // Germany
  { brand: "goertz", sites: { DE: "https://goertz.de" }, makerFromVendor: true },
  { brand: "jackwolfskin", sites: { DE: "https://www.jack-wolfskin.com" } },
  { brand: "snocks", sites: { DE: "https://snocks.com" } },
  { brand: "purelei", sites: { DE: "https://purelei.com" }, defaultGender: "kadin" },
  { brand: "paulvalentine", sites: { DE: "https://www.paul-valentine.com" }, defaultGender: "kadin" },
  // France
  { brand: "lecoqsportif", sites: { FR: "https://www.lecoqsportif.com" } },
  { brand: "andre", sites: { FR: "https://www.andre.fr" }, defaultGender: "kadin" },
];
