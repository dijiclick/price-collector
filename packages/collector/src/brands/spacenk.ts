/**
 * Space NK UK (spacenk.com/uk) — multi-brand beauty on SFCC (SFRA).
 *
 * The sale grid (`Search-UpdateGrid?cgid=sale`) is server-rendered, and each
 * tile carries its analytics JSON in `data-snk-e-cxt`: price, previousPrice,
 * availability, stockCount, brand, masterSku. Measured 2026-10-11, plain request.
 *
 * The catch: a page holds 36 products but only the first 12 are rendered; the
 * other 24 are `<re-call>` placeholders the browser fills one HTTP call per
 * tile, and `sz`/`start` are ignored (only `page` moves). So the grid is read
 * in several sort orders — by discount, price both ways, newest — and the
 * rendered dozen of every page is pooled. On 2026-10-11 that reached 387 of
 * 482 sale products (331 discounted) in 56 calls; per-tile calls would need
 * ~330 more. Shades are separate SKUs, so there is no per-size stock here.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

const SITE = "https://www.spacenk.com";
const GRID = `${SITE}/on/demandware.store/Sites-spacenkgb-Site/en_GB/Search-UpdateGrid?cgid=sale&orderableOnly=`;
const SORTS = ["By%20Discount", "price-high-to-low", "price-low-to-high", "New_In_with_category_position"];
const PAGE_SIZE = 36;
const MAX_PAGES_PER_SORT = 14;
const PAUSE_MS = Number(process.env.SPACENK_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SnkTile {
  cxt: any;
  href: string | null;
  image: string | null;
}

/** The rendered product tiles of one grid page. Pure. */
export function parseSnkGrid(html: string): SnkTile[] {
  const starts = [...html.matchAll(/class="product" data-pid="/g)].map((m) => m.index!);
  const out: SnkTile[] = [];
  starts.forEach((a, i) => {
    const seg = html.slice(a, starts[i + 1] ?? html.length);
    const raw = seg.match(/data-snk-e-cxt='(\[\{"\$entity":"product"[^']*\])'/);
    const cxt = raw ? jsonOf<any[]>(decodeEntities(raw[1]))?.[0] : null;
    if (!cxt) return;
    const img = seg.match(/<img[^>]*class="tile-image[^>]*>/);
    out.push({
      cxt,
      href: seg.match(/href="(\/uk\/[^"]+\.html)"/)?.[1] ?? null,
      image: img ? attrOf(img[0], "src") : null,
    });
  });
  return out;
}

/** "Berry &amp; Bloom" by "Gisou" → "Gisou Berry & Bloom". */
function nameOf(brand: string, name: string): string {
  const n = decodeEntities(name).replace(/\s+/g, " ").trim();
  const b = decodeEntities(brand).trim();
  return b && !n.toLowerCase().startsWith(b.toLowerCase()) ? `${b} ${n}` : n;
}

/** One rendered tile → record. Pure. */
export function mapSnkTile(t: SnkTile, country: CountryCode = "GB"): ProductRecord | null {
  const c = t.cxt ?? {};
  const price = Number(c.priceGBP ?? c.price);
  const prev = Number(c.previousPriceGBP ?? c.previousPrice);
  const id = c.masterSku ?? c.sku;
  if (!id || !c.name || !t.href || !Number.isFinite(price) || price <= 0) return null;
  // Tile photos are 292px renditions; ask the image service for a larger one.
  const image = t.image ? t.image.replace(/\?sw=\d+&sh=\d+/, "?sw=800&sh=800") : null;
  return {
    brand: "spacenk",
    country,
    externalId: String(id),
    name: nameOf(String(c.brand ?? ""), String(c.name)),
    url: `${SITE}${t.href}`,
    imageUrl: image,
    images: cleanGallery([image]),
    price: toMinor(price),
    listPrice: Number.isFinite(prev) && prev > price ? toMinor(prev) : null,
    currency: c.currency ?? COUNTRIES[country].currency,
    inStock: c.availability === "IN_STOCK" || (c.availability == null && Number(c.stockCount) > 0),
    category: typeof c.category === "string" && !/badge/i.test(c.category) ? c.category.replace(/-/g, " ") : null,
    gender: null,
    variants: null,
  };
}

/** "482 Results" in the grid header, or null. */
export function snkTotal(html: string): number | null {
  const m = html.match(/([\d,]+)\s*Results\b/);
  const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Register as `listSpaceNk(country)`. GB only. */
export async function listSpaceNk(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cap = 1500;
  const byId = new Map<string, ProductRecord>();
  let pages = MAX_PAGES_PER_SORT;
  let calls = 0;
  for (const srule of SORTS) {
    for (let page = 1; page <= pages; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const html = await getText(`${GRID}&srule=${srule}&page=${page}`, { country });
      if (calls === 1) {
        const total = snkTotal(html);
        if (total) pages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES_PER_SORT);
      }
      const tiles = parseSnkGrid(html);
      if (!tiles.length) break;
      for (const t of tiles) {
        const r = mapSnkTile(t, country);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
