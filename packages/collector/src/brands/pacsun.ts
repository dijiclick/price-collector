/**
 * PacSun (pacsun.com, US) — SFCC SFRA behind Cloudflare.
 *
 * Cloudflare answers a browser UA from a GitHub runner with 403 on most runs
 * (one probe in three got through), but passes the app UA `okhttp/4.12.0`
 * every time (probe run 39135501893, 2026-10-18; Hetzner box too). See
 * `_okgrid.ts`. Route: `Search-UpdateGrid` over the three sale categories.
 *
 * Each tile carries its data as attributes: `data-product_id`, name, colour,
 * `data-markdown` ("permanent price discount" — a real markdown, not a promo),
 * division and subdepartment on the add-to-bag button, and the quick-shop size
 * buttons, which list the sizes still orderable (a sold-out size is simply
 * absent). The tile price is the sale price over the struck list price; the
 * "Extra 50% Off - Applies in cart" line is a checkout promotion and is
 * ignored, as Gap's is.
 *
 * PacSun is a multi-brand store (Pacsun, Your Favorite, Beverly and Beck,
 * adidas…); every row is the store's own listing at the store's price.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities } from "./_sfcchtml";
import { dollars, okGrid, sleep, splitTiles } from "./_okgrid";

export const brand = "pacsun";
const HOST = "https://www.pacsun.com";

export const PACSUN_SALES: [cgid: string, gender: ProductRecord["gender"]][] = [
  ["womens-sale", "kadin"],
  ["mens-sale", "erkek"],
  ["kids-sale", "cocuk"],
];

const PAGE = 120;
const MAX_CALLS = 30;
const CAP = Number(process.env.PACSUN_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.PACSUN_PAUSE_MS ?? 700);

export const pacsunGridUrl = (cgid: string, start: number) =>
  `${HOST}/on/demandware.store/Sites-pacsun-Site/default/Search-UpdateGrid?cgid=${cgid}&start=${start}&sz=${PAGE}`;

export const pacsunTiles = (html: string): string[] => splitTiles(html, /<div class="js-tile-wrapper\b/);

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function genderOf(division: string | null, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  if (/^women/i.test(division ?? "")) return "kadin";
  if (/^men/i.test(division ?? "")) return "erkek";
  if (/kid|girl|boy/i.test(division ?? "")) return "cocuk";
  return fallback;
}

/** One grid tile → record (markdowns only). Pure. */
export function mapPacsunTile(tile: string, fallbackGender: ProductRecord["gender"] = null, country: CountryCode = "US"): ProductRecord | null {
  const head = tile.match(/<div class="product-tile"[^>]*>/)?.[0] ?? "";
  const bag = tile.match(/<button data-click_name="Add to Bag"[^>]*>/)?.[0] ?? "";
  const pid = attrOf(head, "data-product_id") ?? attrOf(tile.slice(0, 600), "data-pid");
  const name = (attrOf(head, "data-product_name") ?? "").replace(/\s+/g, " ").trim();
  const href = tile.match(/<a class="link" href="([^"]+\.html)"/)?.[1] ?? tile.match(/href="(\/[^"]+\.html)"/)?.[1];
  if (!pid || !name || !href) return null;

  const priceBlock = tile.slice(tile.indexOf('<div class="price">'));
  const sale = dollars(priceBlock.match(/bfx-sale-price"\s+content="([\d.,]+)"/)?.[1]);
  const list = dollars(priceBlock.match(/bfx-list-price"\s+content="([\d.,]+)"/)?.[1]);
  if (!(sale > 0) || !(list > sale)) return null;

  const colour = attrOf(head, "data-product_color");
  const sub = attrOf(bag, "data-product_subdepartment");
  const sizes: SizeVariant[] = [];
  for (const m of tile.matchAll(/<button data-click_name="([^"]*)"\s+class="btn text-btn-cta js-quick-shop-attribute[^"]*"[^>]*data-attr="size"/g)) {
    const label = decodeEntities(m[1]).trim();
    if (label && !sizes.some((s) => s.label === label)) sizes.push({ label, availability: "in_stock" });
  }
  // srcset lists widths of ONE photo; the tile shows the front (and a hover back) shot.
  const photos = [...new Set([...tile.matchAll(/https:\/\/www\.pacsun\.com\/dw\/image\/v2\/[^"\s?,]+\.jpg/g)].map((m) => `${m[0]}?sw=900`))];
  return {
    brand,
    country,
    externalId: pid,
    name,
    url: `${HOST}${decodeEntities(href)}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: true, // the sale grid lists orderable products; `sizes` holds what is left
    category: sub ? titleCase(sub.replace(/^[WMBGK]\s+/i, "")) : null,
    gender: genderOf(attrOf(bag, "data-product_division"), fallbackGender),
    variants: sizes.length ? { colors: colour ? [titleCase(colour)] : [], sizes } : null,
    groupKey: null,
    colorName: colour ? titleCase(colour) : null,
  };
}

export async function listPacsun(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const [cgid, gender] of PACSUN_SALES) {
    for (let start = 0; calls < MAX_CALLS && byId.size < CAP; start += PAGE) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const tiles = pacsunTiles(await okGrid(pacsunGridUrl(cgid, start)));
      for (const t of tiles) {
        const r = mapPacsunTile(t, gender, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (tiles.length < PAGE) break;
    }
  }
  if (!byId.size) throw new Error(`pacsun/${country}: no sale markdowns`);
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listPacsun;
