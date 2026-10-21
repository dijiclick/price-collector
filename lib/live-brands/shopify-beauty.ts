/**
 * Beauty brand storefronts on Shopify for the US/CA "double the brands" round
 * (2026-10-21). Same row shape and collector as SHOPIFY_STORES (_shopify.ts →
 * listShopify). Each site answered a GitHub runner with an open
 * `/products.json`, and its prices are in the market's currency: the CA rows
 * use the Shopify Markets sub-folder (`/en-ca`), whose products.json is priced
 * in CAD (the root stays USD even with the localization cookie).
 *
 * Beauty shops put a "value" compare-at on kits, duos and sets (the sum of the
 * parts), and some on bigger sizes — those are not markdowns, so `skipTitle`
 * (matched against `title | product_type`, honoured by mapShopify) drops them.
 *
 * Checked and left out (2026-10-21, full products.json walks): Clinique and
 * M·A·C US (1,256 / 1,962 products, no compare-at at all), Huda Beauty, Rhode
 * (none), Sol de Janeiro, Summer Fridays, Glow Recipe, Tatcha, Laneige US,
 * amika (headless Hydrogen; Storefront API) and The Body Shop US/CA — their
 * only compare-ats are on sets/bundles/gifts. Olaplex: every liter/jumbo is
 * "$96 vs $160" (the per-ml price of the small bottle) plus pro-only wholesale
 * rows. bareMinerals CA: 3 rows of 6–12% that do not match the US markdown.
 */
import type { ShopifySite } from "./shopify-sites";

/** `skipTitle` is declared on ShopifySite by the 2026-10-18 Fenty change; this keeps the file compiling before that lands. */
export type BeautySite = ShopifySite & { skipTitle?: RegExp };

export const SHOPIFY_BEAUTY: BeautySite[] = [
  // ~105 of 446 US rows reduced, 73 of them "Makeup Set" combos priced against the parts.
  {
    brand: "tarte",
    sites: { US: "https://tartecosmetics.com", CA: "https://tartecosmetics.com/en-ca" },
    skipTitle: /\bmakeup set\b|\b(sets?|duo|trio|kits?|bundle|advent|value|collector'?s?|clutch|wardrobe)\b|\+|&\s*brush\b/i,
  },
  // Multi-brand beauty retailer; ~6% of 5.6k rows reduced (".97" clearance). Home goods and loyalty rewards out.
  {
    brand: "bluemercury",
    sites: { US: "https://bluemercury.com" },
    skipTitle:
      /\| (bundle|candles|diffusers|showerheads|snuffers|surface cleaners|pillow case|pill case|hair sets|skin care sets|fragrance sets|gwp|lp-reward|hair dryers|mirrors|home fragrance)$|\b(sets?|duo|trio|kits?|bundle|value|gift)\b/i,
  },
  { brand: "colourpop", sites: { US: "https://colourpop.com" }, skipTitle: /\b(sets?|bundle|kits?|vault|collection|duo|trio|advent)\b|^neutral swipe\b/i },
  { brand: "bareminerals", sites: { US: "https://www.bareminerals.com" }, skipTitle: /\b(sets?|duo|trio|kits?|bundle|value|advent)\b/i },
];
