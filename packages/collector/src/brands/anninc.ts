/**
 * Ann Taylor (anntaylor.com) and LOFT US (loft.com) — one company (Ann Inc.),
 * one SFCC SFRA codebase, one adapter.
 *
 * Route: the storefront's own grid endpoint, `Search-UpdateGrid` on the
 * all-sale category, asked with an app User-Agent (see `_okgrid.ts`): with a
 * browser UA PerimeterX redirects datacenter IPs to `/px?url=…`, with
 * `okhttp/4.12.0` it answers the grid (probe run 39135501893, 2026-10-18:
 * 200, 120 tiles a page, pages 1–3, both sites). There is no search feed to
 * use instead — Reflektion is switched off in the site prefs, the Cimulate
 * widget is a chat session, and OCAPI wants a client id the site never ships.
 *
 * Prices. Each tile prints one block per customer segment; only the `US`
 * (anonymous shopper) block is read. On sale tiles it carries:
 *   xcc-now-price  the price the site charges today, "PRICE AS MARKED" — the
 *                  extra-%-off promotion already applied, no code (red);
 *   strike         the sale price before that promotion;
 *   original       the full price, "(original $X)".
 * The record's price is the now price (what the shopper pays — same call as
 * Hobbs' promo price in tfglondon.ts) and its list price the original. A tile
 * without a promotion has just normal + strike, read the same way. Ranges
 * (a style whose colours/sizes differ) are folded conservatively: the TOP of
 * the current range against the BOTTOM of the was range, so the discount shown
 * is one every variant gets.
 *
 * One tile is one style shown in one colour; the id is the style id (what a
 * pasted `/…/<pid>.html` url carries), the colour rides as colorName. The grid
 * lists orderable styles only and has no per-size stock.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities } from "./_sfcchtml";
import { dollars, okGrid, sleep, splitTiles } from "./_okgrid";

export type AnnIncBrand = "anntaylor" | "loft";

interface AnnSite {
  host: string;
  siteId: string;
  /** The all-sale category (it contains the clearance/final-sale ones). */
  cgid: string;
  /** Cloudinary folder on assets.<brand>.com. */
  imageHost: string;
}

export const ANN_SITES: Record<AnnIncBrand, AnnSite> = {
  anntaylor: { host: "https://www.anntaylor.com", siteId: "AnnTaylor", cgid: "cata000055", imageHost: "assets.anntaylor.com" },
  loft: { host: "https://www.loft.com", siteId: "Loft", cgid: "catl000065", imageHost: "assets.loft.com" },
};

const PAGE = 120;
const MAX_PAGES = 13;
const CAP = Number(process.env.ANNINC_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.ANNINC_PAUSE_MS ?? 800);

export function annGridUrl(slug: AnnIncBrand, start: number): string {
  const s = ANN_SITES[slug];
  return `${s.host}/on/demandware.store/Sites-${s.siteId}-Site/default/Search-UpdateGrid?cgid=${s.cgid}&start=${start}&sz=${PAGE}`;
}

const TILE_START = /<div class="[^"]*\bproducTileBlock\b[^"]*"/;

/** Every tile of one grid fragment. */
export const annTiles = (html: string): string[] => splitTiles(html, TILE_START);

interface Prices { now: number; was: number }

/**
 * The anonymous-shopper (`US`) price block of a tile → the price charged now
 * and the struck/original price, or null when it is not a markdown.
 */
export function annPrices(tile: string): Prices | null {
  const at = tile.indexOf('data-attribute-customerseg="US"');
  if (at < 0) return null;
  const end = tile.indexOf("data-attribute-customerseg=", at + 30);
  const seg = tile.slice(at, end > at ? end : undefined);
  const split = seg.indexOf("pd-group-sale");
  const xcc = split >= 0 && seg.includes("xcc-now-price") ? seg.slice(0, split) : "";
  const rest = xcc ? seg.slice(split) : seg;

  const valued = (s: string) =>
    [...s.matchAll(/content="([\d.,]+)"[\s\S]*?ds-price-style-(normal|strike|original)/g)].map((m) => ({ v: dollars(m[1]), style: m[2] }));
  const nowXcc = valued(xcc).map((x) => x.v).filter((v) => v > 0);
  const vals = valued(rest);
  const of = (style: string) => vals.filter((x) => x.style === style).map((x) => x.v).filter((v) => v > 0);
  const normal = of("normal");
  const strike = of("strike");
  const original = of("original");

  const nowList = nowXcc.length ? nowXcc : normal.length ? normal : [];
  const wasList = original.length ? original : strike;
  if (!nowList.length || !wasList.length) return null;
  const now = Math.max(...nowList);
  const was = Math.min(...wasList);
  return now > 0 && was > now ? { now, was } : null;
}

/** `sale-shoes` → "Shoes", `jackets-and-blazers` → "Jackets And Blazers". */
const titleCase = (s: string) => s.replace(/^sale-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** One grid tile → record (markdowns only). Pure. */
export function mapAnnTile(slug: AnnIncBrand, tile: string, country: CountryCode = "US"): ProductRecord | null {
  const site = ANN_SITES[slug];
  const pid = tile.match(/^<div[^>]*\bid="([A-Za-z0-9_-]+)"/)?.[1] ?? tile.match(/data-pid="([A-Za-z0-9_-]+)"/)?.[1];
  if (!pid) return null;
  // The tile's own link: `/…/<pid>.html`, or `/…/grp_<pid>_<colour>.html` for a grouped style.
  const href = [...tile.matchAll(/href="(\/[^"?#]+\.html)/g)].map((m) => m[1]).find((h) => h.includes(pid));
  const rawName =
    tile.match(/product-name-div">([^<]+)</)?.[1] ??
    tile.match(/productNameComponent">([^<]+)</)?.[1] ??
    tile.match(/title="Quick View for ([^"]+)"/)?.[1];
  const name = rawName ? decodeEntities(rawName).replace(/\s+/g, " ").trim() : "";
  if (!href || !name) return null;
  const p = annPrices(tile);
  if (!p) return null;

  const colour = tile.match(/data-filter-color="([A-Za-z0-9]+)"/)?.[1] ?? null;
  // The selected swatch names the colour ("Navy White Tweed Combo").
  let colourName: string | null = null;
  for (const m of tile.matchAll(/<a [^>]*\battr-swatch\b[^>]*>/g)) {
    if (colour && !m[0].includes(`_color=${colour}`)) continue;
    colourName = attrOf(m[0], "title")?.trim() || null;
    if (colourName) break;
  }
  const esc = site.imageHost.replace(/\./g, "\\.");
  const photos = [...tile.matchAll(new RegExp(`https://${esc}/image/upload/t_fullplp/[^"\\s&]+`, "g"))]
    .map((m) => m[0])
    .filter((u) => !colour || u.includes(`/${pid}_${colour}`));
  // Category from the path: /clothing/jackets-and-blazers/cata000017/<slug>/<pid>.html
  const segs = href.split("/").filter(Boolean);
  const catSeg = segs.length >= 4 ? segs[segs.length - 4] : null;

  return {
    brand: slug,
    country,
    externalId: pid,
    name,
    url: `${site.host}${href}${colour && !href.includes("grp_") ? `?dwvar_${pid}_color=${colour}` : ""}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(p.now),
    listPrice: toMinor(p.was),
    currency: COUNTRIES[country].currency,
    inStock: true, // the grid lists orderable styles only
    category: catSeg && !/^cat[a-z]?\d+$/.test(catSeg) ? titleCase(catSeg) : null,
    gender: "kadin",
    variants: null,
    groupKey: null,
    colorName: colourName,
  };
}

/** Register as `listAnnInc("anntaylor" | "loft", country)`. US only. */
export async function listAnnInc(slug: AnnIncBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let tilesSeen = 0;
  for (let page = 0; page < MAX_PAGES && byId.size < CAP; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const tiles = annTiles(await okGrid(annGridUrl(slug, page * PAGE)));
    tilesSeen += tiles.length;
    for (const t of tiles) {
      const r = mapAnnTile(slug, t, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (tiles.length < PAGE) break;
  }
  if (!byId.size) throw new Error(`${slug}/${country}: no markdown tiles (${tilesSeen} tiles read)`);
  return [...byId.values()].slice(0, CAP);
}
