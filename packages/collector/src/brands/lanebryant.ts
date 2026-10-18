/**
 * Lane Bryant (lanebryant.com, US) — SFCC SFRA, same PerimeterX setup as Ann
 * Taylor/LOFT (a sister company): a browser UA from a datacenter IP is
 * redirected to `/px?…`, the app UA `okhttp/4.12.0` gets the grid (probe run
 * 39135501893, 2026-10-18: 200 from a GitHub runner). See `_okgrid.ts`.
 *
 * Route: `Search-UpdateGrid` over the clearance subcategories, which also
 * gives each row a category (the product urls carry none). The tile prints the
 * struck price inside `<del>` and the price the site charges now — clearance
 * plus the "Final Sale Extra N% Off" it applies itself — in the `sales` spans.
 * Ranges (a style whose colours differ) are folded conservatively: the top of
 * the current range against the bottom of the struck one.
 *
 * Women's plus-size only. No per-size stock on the tile; the grid lists
 * orderable styles only.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";
import { dollars, okGrid, sleep, splitTiles } from "./_okgrid";

export const brand = "lanebryant";
const HOST = "https://www.lanebryant.com";

/**
 * Clearance subcategories (the refinements on /clearance, read 2026-10-18 and
 * checked by their first products — the ids are NOT in the visible order).
 */
export const LB_CATEGORIES: [cgid: string, label: string][] = [
  ["cat10232", "Tops"],
  ["cat10234", "Bottoms"],
  ["cat10231", "Dresses & Jumpsuits"],
  ["cat10239", "Jackets & Coats"],
  ["cat10236", "Activewear"],
  ["cat1511006", "Bras"],
  ["cat1511007", "Panties"],
  ["cat1511005", "Sleep & Lingerie"],
  ["cat1511008", "Swim"],
  ["cat10238", "Shoes & Accessories"],
];

const PAGE = 96;
const MAX_CALLS = 40;
const CAP = Number(process.env.LANEBRYANT_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.LANEBRYANT_PAUSE_MS ?? 700);

export const lbGridUrl = (cgid: string, start: number) =>
  `${HOST}/on/demandware.store/Sites-LaneBryant-Site/default/Search-UpdateGrid?cgid=${cgid}&start=${start}&sz=${PAGE}`;

export const lbTiles = (html: string): string[] => splitTiles(html, /<div class="[^"]*\bproducTileBlock\b[^"]*"/);

/** The price block → now (top of range) and was (bottom of the struck range). */
export function lbPrices(tile: string): { now: number; was: number } | null {
  const a = tile.indexOf("price-wrapper");
  if (a < 0) return null;
  const endMarks = ["plp-reskin-promo", "tile-body-footer", "END_dwmarker"].map((m) => tile.indexOf(m, a)).filter((i) => i > a);
  const block = tile.slice(a, endMarks.length ? Math.min(...endMarks) : a + 4000);
  const del = block.match(/<del>([\s\S]*?)<\/del>/)?.[1] ?? "";
  const after = block.replace(/<del>[\s\S]*?<\/del>/, "");
  const was = [...del.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => dollars(m[1])).filter((v) => v > 0);
  const now = [...after.matchAll(/content="([\d.,]+)"/g)].map((m) => dollars(m[1])).filter((v) => v > 0);
  if (!was.length || !now.length) return null;
  const n = Math.max(...now);
  const w = Math.min(...was);
  return w > n ? { now: n, was: w } : null;
}

/** One grid tile → record (markdowns only). Pure. */
export function mapLbTile(tile: string, category: string | null, country: CountryCode = "US"): ProductRecord | null {
  const pid = tile.match(/^<div[^>]*\bid="([A-Za-z0-9_-]+)"/)?.[1] ?? tile.match(/data-pid="([A-Za-z0-9_-]+)"/)?.[1];
  if (!pid) return null;
  const link = tile.match(/<a class="link bfx-product-name" href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  if (!link) return null;
  const href = decodeEntities(link[1]);
  const path = href.split("?")[0];
  // The colour the tile SHOWS is the image link's; the name link points at the first swatch.
  const imgHref = decodeEntities(tile.match(/<a class="plp-tile-img" href="([^"]+)"/)?.[1] ?? "");
  const colourRe = new RegExp(`dwvar_${pid}_color=([A-Za-z0-9]+)`);
  const colour = imgHref.match(colourRe)?.[1] ?? href.match(colourRe)?.[1] ?? null;
  const name = decodeEntities(link[2]).replace(/\s+/g, " ").trim();
  const p = lbPrices(tile);
  if (!name || !p) return null;
  // Photos of the shown colour: main + back from the swatch data / picture tags.
  const photos = [...tile.matchAll(/https:\/\/assets\.lanebryant\.com\/image\/upload\/t_large\/[^"\s&]+/g)]
    .map((m) => m[0])
    .filter((u) => !colour || u.includes(`/${pid}_${colour}`));
  return {
    brand,
    country,
    externalId: pid,
    name,
    url: `${HOST}${path}${colour ? `?dwvar_${pid}_color=${colour}` : ""}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(p.now),
    listPrice: toMinor(p.was),
    currency: COUNTRIES[country].currency,
    inStock: true,
    category,
    gender: "kadin",
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

export async function listLaneBryant(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const [cgid, label] of LB_CATEGORIES) {
    for (let start = 0; calls < MAX_CALLS && byId.size < CAP; ) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const tiles = lbTiles(await okGrid(lbGridUrl(cgid, start)));
      start += tiles.length; // the first page can come back shorter than asked (48 of 96)
      let fresh = 0;
      for (const t of tiles) {
        const r = mapLbTile(t, label, country);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          fresh++;
        }
      }
      // Past the end the grid comes back empty or repeats the last page.
      // Fewer than the smallest page the server ever sends (48) = the last page.
      if (tiles.length < 48 || fresh === 0) break;
    }
  }
  if (!byId.size) throw new Error(`lanebryant/${country}: no clearance markdowns`);
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listLaneBryant;
