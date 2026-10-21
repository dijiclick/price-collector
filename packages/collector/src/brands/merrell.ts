/**
 * Merrell — US and Canada (www.merrell.com/US/en, /CA/en_CA). Added 2026-10-21.
 *
 * Not Shopify: Wolverine runs Merrell on Salesforce Commerce Cloud
 * (SiteGenesis, sites `merrell_us` / `merrell_ca`). There is no public search
 * key on the page (no Constructor/Algolia), so the sale category's own product
 * grid is read: `<category>/?sz=N&start=K&format=ajax` returns just the grid
 * HTML. It answers a GitHub runner directly (probe 39651857674); no proxy.
 *
 * Categories: `seasonal-sale` (US, ~400 styles×colours) and `clearance-sale`
 * plus `seasonal-sale` (CA). Each `grid-tile` is one colour: `data-itemid`
 * (style) + `data-color-id` (colour), the name (with a Women's/Men's/Kids'
 * prefix), link, image, and `product-pricing`. A row is kept only when the tile
 * shows BOTH `product-sales-price` and a struck `product-standard-price`
 * (`title="Regular Price"`). Tiles with only a price range ("$49.99 - $58.99")
 * show no strikethrough and are skipped — a range is never read as a discount.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "merrell";

const SITES: Partial<Record<CountryCode, { base: string; categories: string[]; currency: string }>> = {
  US: { base: "https://www.merrell.com/US/en", categories: ["seasonal-sale"], currency: "USD" },
  CA: { base: "https://www.merrell.com/CA/en_CA", categories: ["seasonal-sale", "clearance-sale"], currency: "CAD" },
};
const CAP = 1500;
const PAGE = 48;
const MAX_PAGES = 20;
const PAUSE_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");

/** "$104.99" / "CA$1,049.99" / "104,99 $" → 104.99; null for ranges and blanks. */
export function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/<[^>]*>/g, " ").trim();
  if (!t || /\d\s*[-–]\s*\D*\d/.test(t)) return null;
  const m = t.match(/(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[ ,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The text inside `<span class="<cls>" …>` (one level of nested spans allowed), minus the visually-hidden label. */
function spanText(tile: string, cls: string): string | null {
  const m = tile.match(new RegExp(`<span class="${cls}"[^>]*>((?:<span[^>]*>[^<]*</span>|[^<])*)</span>`));
  if (!m) return null;
  return m[1].replace(/<span class="visually-hidden">[^<]*<\/span>/g, "").replace(/<[^>]*>/g, "").trim();
}

export function genderOf(name: string): ProductRecord["gender"] {
  if (/^(kids|big kids|little kids|toddler|girls|boys|baby)\b|\bkids'/i.test(name)) return "cocuk";
  if (/^women'?s\b/i.test(name)) return "kadin";
  if (/^men'?s\b/i.test(name)) return "erkek";
  return null;
}

/** Map one `grid-tile` chunk. Pure; null unless the tile shows a struck regular price above the sale price. */
export function mapMerrellTile(tile: string, country: CountryCode): ProductRecord | null {
  const site = SITES[country];
  if (!site) return null;
  const style = tile.match(/data-itemid="([^"]+)"/)?.[1];
  const colourId = tile.match(/data-color-id="([^"]+)"/)?.[1] ?? tile.match(/dwvar_[^_]+_color=([A-Za-z0-9]+)/)?.[1] ?? "";
  const rawName = tile.match(/itemprop="name" content="([^"]+)"/)?.[1];
  const href = tile.match(/<a class="name-link" href="([^"]+)"/)?.[1] ?? tile.match(/<a class="thumb-link" href="([^"]+)"/)?.[1];
  if (!style || !rawName || !href) return null;
  const price = parseMoney(spanText(tile, "product-sales-price"));
  const was = parseMoney(spanText(tile, "product-standard-price"));
  if (price == null || was == null || price >= was) return null;
  const name = decode(rawName).trim();
  const imgs = [
    tile.match(/data-main-image-url="([^"]+)"/)?.[1],
    tile.match(/data-alt-image-url="([^"]+)"/)?.[1],
  ].filter((u): u is string => !!u).map(decode);
  const attrs = tile.match(/data-product-attributes="([^"]*)"/)?.[1];
  let category: string | null = null;
  let colour: string | null = null;
  if (attrs) {
    try {
      const a = JSON.parse(decode(attrs));
      category = typeof a.classification === "string" && a.classification ? a.classification : null;
      colour = typeof a.genericColor === "string" && a.genericColor ? a.genericColor : null;
    } catch {
      /* attributes are optional */
    }
  }
  const colourName = tile.match(/aria-label="[^"]*?, ([^"]+)"/)?.[1] ?? colour;
  return {
    brand,
    country,
    externalId: colourId ? `${style}-${colourId}` : style,
    name,
    url: decode(href),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: site.currency,
    // The sale grid lists only orderable colours (sold-out styles drop off it).
    inStock: true,
    category,
    gender: genderOf(name),
    variants: null,
    groupKey: style,
    colorName: colourName ? decode(colourName) : null,
  };
}

/** Split a grid page into tiles and map them. Pure. */
export function parseMerrellGrid(html: string, country: CountryCode): { rows: ProductRecord[]; tiles: number; total: number | null } {
  const tiles = html.split('class="grid-tile').slice(1);
  const rows: ProductRecord[] = [];
  for (const t of tiles) {
    const r = mapMerrellTile(t, country);
    if (r) rows.push(r);
  }
  const total = Number(html.match(/class="product-result-count"[^>]*>\s*([\d,]+)\s*Products?/i)?.[1]?.replace(/,/g, ""));
  return { rows, tiles: tiles.length, total: Number.isFinite(total) ? total : null };
}

export async function listMerrell(country: CountryCode): Promise<ProductRecord[]> {
  const site = SITES[country];
  if (!site) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const cat of site.categories) {
    let total: number | null = null;
    let start = 0;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new Error(`merrell/${country}: ${cat} exceeds ${MAX_PAGES} pages`);
      if (requests++ > 0) await sleep(PAUSE_MS);
      // The site serves at most 48 tiles a request whatever `sz` asks for, so `start` steps by what came back.
      const url = `${site.base}/${cat}/?sz=${PAGE}&start=${start}&format=ajax`;
      const html = await getText(url, { country, timeoutMs: 45_000, retries: 2 });
      const p = parseMerrellGrid(html, country);
      if (page === 0) {
        total = p.total;
        if (!p.tiles) throw new Error(`merrell/${country}: ${cat} returned no product grid`);
      }
      for (const r of p.rows) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
      start += p.tiles;
      if (!p.tiles || (total != null && start >= total) || (total == null && p.tiles < PAGE)) break;
    }
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error(`merrell/${country}: 0 reduced tiles in ${site.categories.join(", ")}`);
  return all.slice(0, CAP);
}

export const listProducts = listMerrell;
