/**
 * Birkenstock US (birkenstock.com/us) — SFCC SFRA behind Cloudflare/Akamai.
 *
 * Route: the storefront's own `Search-UpdateGrid` on the sale category
 * (`last-chance`, ~600 styles). It answers a GitHub runner with a browser UA
 * and with the app UA alike (probe runs 39134394432 / 39135501893,
 * 2026-10-18); the app UA is used for consistency with the other SFCC grids
 * (`_okgrid.ts`). No lighter feed exists — no search provider, OCAPI wants a
 * client id — and the server caps a page at 24 tiles (~2 MB of markup), so a
 * full sweep is ~25 calls; MAX_CALLS caps it.
 *
 * Each tile carries `data-analytics` JSON (id, name, model, category levels,
 * gender in `item_category5`, colour, art no., `item_meta` stock flag) and a
 * default price block "Was $X / is $Y / -N%". One record per tile = one style
 * in one colour (the id ends in `_<colourId>`, which is also the product url's).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";
import { dollars, okGrid, sleep, splitTiles } from "./_okgrid";

export const brand = "birkenstock";
const HOST = "https://www.birkenstock.com";
const CGID = "last-chance";
const PAGE = 24; // server-side cap; asking for more still returns 24
const MAX_CALLS = 30;
const CAP = Number(process.env.BIRKENSTOCK_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.BIRKENSTOCK_PAUSE_MS ?? 700);

export const birkGridUrl = (start: number) =>
  `${HOST}/on/demandware.store/Sites-US-Site/en_US/Search-UpdateGrid?cgid=${CGID}&start=${start}&sz=${PAGE}`;

export const birkTiles = (html: string): string[] => splitTiles(html, /<div\s+class="b-product_tile grid-tile\b/);

/** "Total results" header of a grid page ("608 products"), or null. */
export function birkTotal(html: string): number | null {
  const n = Number(html.match(/([\d,]+)\s+products\b/)?.[1]?.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function genderOf(g: string): ProductRecord["gender"] {
  if (/^wom/i.test(g)) return "kadin";
  if (/^men/i.test(g)) return "erkek";
  if (/kid|child|youth/i.test(g)) return "cocuk";
  return null; // Unisex
}

/** One grid tile → record (markdowns only). Pure. */
export function mapBirkTile(tile: string, country: CountryCode = "US"): ProductRecord | null {
  const open = tile.slice(0, tile.indexOf(">", tile.indexOf("data-analytics=")) + 1);
  const a = jsonOf<any>(attrOf(open, "data-analytics") ?? "") ?? {};
  const pid = attrOf(open, "data-pid") ?? a.item_id;
  const name = decodeEntities(String(attrOf(open, "data-product-name") ?? a.item_name ?? "")).replace(/\s+/g, " ").trim();
  const href = tile.match(/href="(\/us\/[^"?#]+\.html)"/)?.[1];
  if (!pid || !name || !href) return null;

  const block = tile.match(/data-price-for="default"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const was = dollars(block.match(/m-old"[^>]*>\s*([^<]+)</)?.[1]);
  const now = dollars(block.match(/m-new"[^>]*>\s*([^<]+)</)?.[1]);
  if (!(now > 0) || !(was > now)) return null;

  // Photos of this colour: the tile's carousel comes first, and the art number
  // folder of its first photo heads every photo of the shown colour (the
  // swatches below it are other art numbers). `item_art_no` is not always
  // that folder (a width variant's number), so the photo itself decides.
  const all = [...tile.matchAll(/(https:\/\/www\.birkenstock\.com\/dw\/image\/v2\/[^"\s?]+\.jpg)/g)].map((m) => m[1]);
  const art = all[0]?.match(/\/(\d{5,})\/[^/]+\.jpg$/)?.[1];
  const photos = [...new Set(all.filter((u) => !art || u.includes(`/${art}/`)))].map((u) => `${u}?sw=900&sh=900&sm=fit&q=80`);
  const colour = typeof a.item_color === "string" && a.item_color.trim() ? a.item_color.trim() : null;
  const category = [a.item_category4, a.item_category3, a.item_category2].find((c) => typeof c === "string" && c.trim()) ?? null;
  return {
    brand,
    country,
    externalId: String(pid),
    name,
    url: `${HOST}${href}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: a.item_meta ? !/out|sold/i.test(String(a.item_meta)) : true,
    category: category ? String(category).trim() : null,
    gender: genderOf(String(a.item_category5 ?? "")),
    variants: null,
    groupKey: a.item_master_id ? `birkenstock:${a.item_master_id}` : null,
    colorName: colour,
  };
}

export async function listBirkenstock(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let call = 0, start = 0; call < MAX_CALLS && start < total && byId.size < CAP; call++) {
    if (call > 0) await sleep(PAUSE_MS);
    const html = await okGrid(birkGridUrl(start));
    if (call === 0) total = birkTotal(html) ?? total;
    const tiles = birkTiles(html);
    if (!tiles.length) break;
    for (const t of tiles) {
      const r = mapBirkTile(t, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    start += tiles.length;
  }
  if (!byId.size) throw new Error(`birkenstock/${country}: no sale markdowns`);
  return [...byId.values()].sort((x, y) => Number(y.inStock) - Number(x.inStock)).slice(0, CAP);
}

export const listProducts = listBirkenstock;
