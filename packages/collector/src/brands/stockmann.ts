/**
 * Stockmann — Finland's department store (stockmann.com), 2026-10-21.
 *
 * Salesforce Commerce Cloud (Sites-STFI-Site). The SFRA grid endpoint answers
 * the GitHub runners and the Mac alike (probe 39634668018: 200, no proxy):
 *
 *   GET /on/demandware.store/Sites-STFI-Site/fi_FI/Search-UpdateGrid
 *       ?cgid=<muoti|kosmetiikka>&prefn1=availableDiscounts&prefv1=sale
 *       &store=ecomm&start=S&sz=96            (X-Requested-With: XMLHttpRequest)
 *
 * `availableDiscounts=sale` is the site's own "ALE" filter: every tile carries
 * "Discounted Price" + "Original Price" (the struck price the shop shows) and
 * an "ALE –NN%" label. Tiles without an original price above the current one
 * are dropped. Fashion (muoti: women/men/kids incl. shoes and bags) and beauty
 * (kosmetiikka); home goods (koti) are out of scope. sz above 96 silently falls
 * back to 36, so pages stay at 96 (~0.7 MB each).
 *
 * Each tile's `data-product` JSON gives name, brand, stock status and the
 * category path (muoti/naiset|miehet|lapset/…), which sets gender.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.stockmann.com";
const GRID = `${ORIGIN}/on/demandware.store/Sites-STFI-Site/fi_FI/Search-UpdateGrid`;
const SECTIONS = ["kosmetiikka", "muoti"] as const;
const PAGE = 96;
const MAX_PAGES_PER_SECTION = 20;
const PAUSE_MS = Number(process.env.STOCKMANN_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "1 107,60 €" → 1107.6 */
export function euros(s: string): number {
  const t = decodeEntities(s).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
}

/** The price text after an sr-only label ("Discounted Price" / "Original Price"). */
function priceAfter(tile: string, label: string): number {
  const m = tile.match(new RegExp(`${label}\\s*</span>([^<]*)<`));
  return m ? euros(m[1]) : NaN;
}

export function stockmannGender(category: unknown): ProductRecord["gender"] {
  const seg = typeof category === "string" ? category.split("/")[1] : "";
  return seg === "naiset" ? "kadin" : seg === "miehet" ? "erkek" : seg === "lapset" ? "cocuk" : null;
}

/** Split a grid response into tiles (one per `<div class="product " data-pid=…>`). */
export function stockmannTiles(html: string): string[] {
  const parts = html.split(/<div class="product\s*" data-pid=/);
  return parts.slice(1).map((p) => `<div class="product" data-pid=${p}`);
}

/** Map one grid tile. Pure. Returns only real markdowns. */
export function mapStockmann(tile: string, country: CountryCode = "FI"): ProductRecord | null {
  const pid = attrOf(tile.slice(0, tile.indexOf(">") + 1), "data-pid");
  const tileTag = tile.match(/<div class="product-tile[^>]*>/)?.[0] ?? "";
  const data = jsonOf<any>(attrOf(tileTag, "data-product") ?? "");
  const href = tile.match(/<a class="pdp-title" href="([^"]+)"/)?.[1];
  if (!pid || !data || !href) return null;
  const name = String(data.name ?? "").trim();
  const maker = String(data.brand ?? "").trim() || null;
  const price = priceAfter(tile, "Discounted Price");
  const was = priceAfter(tile, "Original Price");
  if (!name || !(price > 0) || !(was > price)) return null;
  const img = tile.match(/data-src="(https:\/\/images\.stockmann\.com\/[^"]+)"/)?.[1] ?? null;
  // Only the grid's 225x300 rendition is signed (the path hash covers the size).
  const big = img;
  const colour = typeof data.variant === "string" && data.variant !== "empty" ? data.variant : null;
  const category = typeof data.category === "string" ? data.category : null;
  return {
    brand: "stockmann",
    country,
    externalId: pid,
    name: maker ? `${maker} ${name}` : name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl: big,
    images: cleanGallery([big], big),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: String(data.stockStatus ?? "").toLowerCase() === "in stock",
    category: category ? category.split("/").slice(-2).join(" ") : null,
    maker,
    gender: stockmannGender(category),
    variants: null,
    colorName: colour,
    groupKey: typeof data.id === "string" ? data.id : null,
  };
}

export async function listStockmann(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  if (country !== "FI") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const cgid of SECTIONS) {
    for (let page = 0; byId.size < cap; page++) {
      if (page >= MAX_PAGES_PER_SECTION) throw new Error(`stockmann/${country}: ${cgid} has more than ${MAX_PAGES_PER_SECTION} pages`);
      if (requests++ > 0) await sleep(PAUSE_MS);
      const url = `${GRID}?cgid=${cgid}&prefn1=availableDiscounts&prefv1=sale&store=ecomm&start=${page * PAGE}&sz=${PAGE}`;
      const html = await getText(url, { headers: { "X-Requested-With": "XMLHttpRequest" }, country, timeoutMs: 30_000 });
      const tiles = stockmannTiles(html);
      if (!tiles.length) {
        if (page === 0) throw new Error(`stockmann/${country}: ${cgid} sale grid is empty`);
        break;
      }
      const before = byId.size;
      for (const t of tiles) {
        const r = mapStockmann(t, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // A full page can hold 95 tiles (a content slot takes one), so only a
      // clearly short page or one with nothing new ends the section.
      if (tiles.length < PAGE / 2 || byId.size === before) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
