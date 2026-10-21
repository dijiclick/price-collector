/**
 * US/Canada Shopify DTC stores — bags, shoes, activewear (2026-10-21, "double
 * the brands" package C). Same row shape and collector (`listShopify`) as
 * ./shopify-sites.ts. Every site answered a GitHub runner with an open
 * `/products.json` (probe run 39649931025) and prices in its market's currency:
 * `/meta.json` currency USD for the US sites, CAD for reebok.ca / jdsports.ca.
 * Rothy's has no Canadian domain; its `/en-ca` Shopify Markets subfolder serves
 * `/products.json` in CAD (meta.json there still reports the shop's base USD —
 * the variant prices are the converted ones: The Point II 109 USD → 160 CAD).
 *
 * reebok (TR = _ftech) and jdsports (GB/EU = jdsports-gb) already exist in other
 * markets: their registry entries dispatch per market, so they must not also be
 * mapped through the generic one-entry-per-store list.
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_DTCC: ShopifySite[] = [
  { brand: "colehaan", sites: { US: "https://www.colehaan.com" } },
  { brand: "toms", sites: { US: "https://www.toms.com" } },
  { brand: "rothys", sites: { US: "https://rothys.com", CA: "https://rothys.com/en-ca" }, defaultGender: "kadin" },
  { brand: "champion", sites: { US: "https://www.champion.com" } },
  { brand: "verabradley", sites: { US: "https://verabradley.com" }, defaultGender: "kadin" },
  { brand: "dooney", sites: { US: "https://www.dooney.com" }, defaultGender: "kadin" },
  { brand: "setactive", sites: { US: "https://setactive.co" }, defaultGender: "kadin" },
  { brand: "allbirds", sites: { US: "https://www.allbirds.com" } },
  // Extensions of brands that exist elsewhere — own registry entry (see header).
  { brand: "reebok", sites: { US: "https://www.reebok.com", CA: "https://www.reebok.ca" } },
  { brand: "jdsports", sites: { CA: "https://www.jdsports.ca" } },
];
