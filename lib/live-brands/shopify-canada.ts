/**
 * Canada-only Shopify storefronts (2026-10-21, "double the brands" round —
 * package "canada"). Same row shape as SHOPIFY_STORES; the lead wires this
 * array in. Each site's `/meta.json` answers `currency: "CAD"` and its
 * `/products.json` is open to a GitHub runner (probe 39652272653).
 *
 * Share of the in-stock catalogue carrying a compare-at price, measured on the
 * Mac 2026-10-21 (none marks its whole catalogue): RW&CO 88%, Penningtons 68%,
 * Oak + Fort ~58%, Kit and Ace ~57%, Call It Spring ~50%, Mackage ~42%, Kotn
 * ~36%, Frank And Oak ~19%, Rudsak ~11%, Bluenotes ~11%, Urban Planet ~14%.
 *
 * Left out: Vessi (CAD only through Shopify Markets, and its sale collection
 * carries no compare-at price — no markdowns to show), Le Château (the store
 * now lives inside suzyshier.com, already collected).
 */
import type { ShopifySite } from "./shopify-sites";

export const SHOPIFY_CANADA: ShopifySite[] = [
  { brand: "penningtons", sites: { CA: "https://www.penningtons.com" }, defaultGender: "kadin" },
  { brand: "callitspring", sites: { CA: "https://www.callitspring.com" } },
  { brand: "rwco", sites: { CA: "https://www.rw-co.com" } },
  { brand: "bluenotes", sites: { CA: "https://www.blnts.com" } },
  { brand: "oakandfort", sites: { CA: "https://www.oakandfort.ca" } },
  { brand: "frankandoak", sites: { CA: "https://www.frankandoak.com" } },
  { brand: "kotn", sites: { CA: "https://kotn.com" } },
  { brand: "rudsak", sites: { CA: "https://www.rudsak.com" } },
  { brand: "mackage", sites: { CA: "https://www.mackage.ca" } },
  { brand: "kitandace", sites: { CA: "https://www.kitandace.com" } },
  { brand: "urbanplanet", sites: { CA: "https://urban-planet.com" } },
];
