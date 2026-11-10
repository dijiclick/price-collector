/**
 * UK Shopify stores added 2026-11-10 (brands round "gb"). Same row shape as
 * SHOPIFY_STORES (./shopify-sites.ts); merged in ./shopify-all.ts. Each site's
 * `/meta.json` says GBP / country GB and `/products.json` answered a GitHub
 * runner (probe runs 42800582417 and 42802608232). Reduced share of the whole
 * catalogue, measured the same day (reduced / products):
 *   Mint Velvet 398/1,712 · Crew Clothing 1,268/3,293 · Nobody's Child
 *   2,665/3,687 (72%, a long archive tail — 1,986 in stock) · RIXO 247/839 ·
 *   Lucy & Yak 434/870 · Club L London 419/3,383 · Chi Chi London 1,318/2,643 ·
 *   Public Desire 643/1,367 · Skinnydip 432/3,478 · TALA 118/949 · Sister Jane
 *   170/506 · Abbott Lyon 494/2,702 · Revolution Beauty 358/717 ·
 *   (The Body Shop: its feed answers a US runner with an empty list — left out.)
 *
 * Fenwick is listed for the pasted-link resolver only; its collector is
 * packages/collector/src/brands/fenwick.ts (sale collections, `maker`).
 *
 * Looked at and left out: In The Style (1,548 of 1,668 "reduced" — 93%),
 * Adanola, Odd Muse, Sophia Webster (no reductions), Missoma / Astrid & Miyu /
 * Daisy / P.Louise / Iconic London (only sets and bundles carry a compare-at),
 * Radley and LK Bennett (Shopify shells: the catalogue is not published to the
 * storefront channel — 2 and 0 products), Hunter (store prices in USD).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_GB: ShopifySite[] = [
  { brand: "mintvelvet", sites: { GB: "https://www.mintvelvet.com" }, defaultGender: "kadin" },
  { brand: "crewclothing", sites: { GB: "https://www.crewclothing.co.uk" } },
  { brand: "nobodyschild", sites: { GB: "https://www.nobodyschild.com" }, defaultGender: "kadin" },
  { brand: "rixo", sites: { GB: "https://www.rixolondon.com" }, defaultGender: "kadin" },
  { brand: "lucyandyak", sites: { GB: "https://lucyandyak.com" } },
  { brand: "clubllondon", sites: { GB: "https://www.clubllondon.com" }, defaultGender: "kadin" },
  { brand: "chichilondon", sites: { GB: "https://www.chichiclothing.com" }, defaultGender: "kadin" },
  { brand: "publicdesire", sites: { GB: "https://www.publicdesire.com" }, defaultGender: "kadin" },
  // Phone and tablet cases are most of its catalogue; the feed is for fashion.
  { brand: "skinnydip", sites: { GB: "https://www.skinnydiplondon.com" }, defaultGender: "kadin", skipTitle: /\b(iphone|phone|airpods?|ipad|macbook|laptop|samsung|magsafe)\b/i },
  { brand: "tala", sites: { GB: "https://www.wearetala.com" }, defaultGender: "kadin" },
  { brand: "sisterjane", sites: { GB: "https://www.sisterjane.com" }, defaultGender: "kadin" },
  // Bundles and gift-with-purchase rows price against the sum of the parts.
  { brand: "abbottlyon", sites: { GB: "https://www.abbottlyon.com" }, defaultGender: "kadin", skipTitle: /\b(bundle|gwp|gift with purchase|sets?|add-?on)\b/i },
  { brand: "revolutionbeauty", sites: { GB: "https://www.revolutionbeauty.com" }, skipTitle: /\b(sets?|duo|trio|kits?|vault|bundle|advent|collection|worth)\b/i },
  { brand: "fenwick", sites: { GB: "https://fenwick.co.uk" } },
];
