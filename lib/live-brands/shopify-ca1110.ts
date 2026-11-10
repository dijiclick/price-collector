/**
 * Canadian Shopify storefronts added 2026-11-10 (Canada round: department,
 * off-price and multi-brand stores, plus Canadian labels we lacked). Same row
 * shape as SHOPIFY_STORES. Every site answered a GitHub runner with an open
 * `/products.json` and `/meta.json` in CAD (probe runs 42797909580,
 * 42798526496, 42798538025, 42799588340), except Club Monaco, whose
 * `/meta.json` names the US shop: clubmonaco.ca prices in CAD through Shopify
 * Markets (`/cart.js` → CAD; the same product is $279/$358 on .ca and $239/$298
 * on .com, probe 42799158188).
 *
 * The first four are read by the generic products.json walk. The stores below
 * them are too big for it (SVP Sports 11,854 products, gravitypope 13,790) or
 * keep a sale collection that is a fraction of the catalogue, and are read per
 * sale collection by packages/collector/src/brands/
 * shopify-ca-outlets.ts; they are listed here so pasted links resolve.
 *
 * Checked and left out: Bench (52 of 55 sampled products carry a compare-at —
 * a standing promo), Allbirds CA (54 of 54), Buffalo David Bitton (76 of 93),
 * Globo (product titles are internal style codes: "Ctas_lift", "All_star-m"),
 * Moose Knuckles, Canada Goose, Converse.ca, Soia & Kyo, Smythe, Poppy &
 * Peonies, La Canadienne, Judith & Charles, Nobis, Kanuk, Quartz Co, Pajar
 * (0-3 reduced products in the samples: no sale on), Kylie/Glossier CA (the
 * reduced rows are value sets).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_CA1110: ShopifySite[] = [
  { brand: "mattandnat", sites: { CA: "https://mattandnat.com" }, defaultGender: "kadin" },
  { brand: "clubmonaco", sites: { CA: "https://www.clubmonaco.ca" } },
  { brand: "tristan", sites: { CA: "https://www.tristanstyle.com" } },
  { brand: "tentree", sites: { CA: "https://www.tentree.ca" } },
];

/** Read per sale collection (shopify-ca-outlets.ts), not by the generic walk. */
export const SHOPIFY_CA1110_OUTLETS: ShopifySite[] = [
  { brand: "svpsports", sites: { CA: "https://www.svpsports.ca" }, vendorAsMaker: true },
  { brand: "gravitypope", sites: { CA: "https://www.gravitypope.com" }, vendorAsMaker: true, vendorInName: true },
  { brand: "livestock", sites: { CA: "https://www.deadstock.ca" }, vendorAsMaker: true },
  { brand: "getoutside", sites: { CA: "https://www.getoutsideshoes.com" }, vendorAsMaker: true },
  // Levi's, The North Face, Dickies, SAXX, Carhartt, RVCA, Herschel…
  { brand: "belowthebelt", sites: { CA: "https://www.belowthebelt.com" }, vendorAsMaker: true, vendorInName: true },
  { brand: "melanielyne", sites: { CA: "https://www.melanielyne.com" }, defaultGender: "kadin" },
];

export const CA1110_OUTLET_BRANDS = SHOPIFY_CA1110_OUTLETS.map((s) => s.brand);
