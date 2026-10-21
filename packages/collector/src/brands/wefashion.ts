/**
 * WE Fashion (wefashion.com) — Dutch fashion chain on Salesforce Commerce
 * Cloud (SFRA). The storefront's infinite-scroll endpoint `Search-UpdateGrid`
 * returns the product tiles as HTML and answers a GitHub runner through
 * Cloudflare with a plain browser UA (probe run 39636006759, 2026-10-21).
 *
 * Markdown shelves: `sale_women`, `sale_men`, `sale_kids` (one per division;
 * `sale_kids` is the union of `sale_boys` + `sale_girls`). Every tile there
 * shows `price__price--is-crossed-out` (the original, `data-value`) and
 * `price__price--is-on-sale` (charged) — the tile's own aria-label reads
 * "van €109,- voor €60,-". The tile's GA4 JSON (`data-gtm-item-GA4`) carries
 * the same `price`/`original_price`, the brand line (WE Fashion / WE Studio /
 * Blue Ridge), division (Dames/Heren/Jongens/Meisjes) and Dutch category.
 * One tile = one style in one colour (`45908644_0507`); the grid lists only
 * sellable styles, so a tile is in stock.
 *
 * One SFCC site per market, same category ids everywhere: WE-NL (nl_NL),
 * WE-BE (nl_BE); EUR. Measured 2026-10-21: NL women 630, men 627, kids 525.
 * Tiles are heavy (~55 KB each), so pages are 100 tiles and the cap is hit
 * after ~16 requests.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";
import { nlType } from "./_nltypes";

const ORIGIN = "https://www.wefashion.com";
const CGIDS = ["sale_women", "sale_men", "sale_kids"] as const;
const PAGE = 100;
const MAX_PAGES = 10; // per category
const CAP = 1500;
const PAUSE_MS = Number(process.env.WEFASHION_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Market { site: string; locale: string }

export const WEFASHION_MARKETS: Partial<Record<CountryCode, Market>> = {
  NL: { site: "WE-NL", locale: "nl_NL" },
  BE: { site: "WE-BE", locale: "nl_BE" },
};

export const wefashionGridUrl = (m: Market, cgid: string, start: number): string =>
  `${ORIGIN}/on/demandware.store/Sites-${m.site}-Site/${m.locale}/Search-UpdateGrid?cgid=${cgid}&start=${start}&sz=${PAGE}`;

/** Split a grid page into product tiles (the class attribute spans several lines). Pure. */
export function wefashionTiles(html: string): string[] {
  return html.split(/<div class="c-product-tile\s/).slice(1).map((t) => '<div class="c-product-tile ' + t);
}

/** "Dames" / "Heren" / "Jongens" / "Meisjes" → our gender. */
function genderOf(division: string): ProductRecord["gender"] {
  if (/jongens|meisjes|kids|baby/i.test(division)) return "cocuk";
  if (/dames/i.test(division)) return "kadin";
  if (/heren/i.test(division)) return "erkek";
  return null;
}

/** One tile → a record, or null when it carries no struck price. Pure. */
export function mapWefashionTile(tile: string, country: CountryCode = "NL"): ProductRecord | null {
  const head = tile.slice(0, tile.indexOf(">") + 1);
  const ga = jsonOf<any>(attrOf(head, "data-gtm-item-GA4") ?? "")?.ecommerce?.items?.[0] ?? {};
  const id = attrOf(head, "data-product-id") ?? (typeof ga.item_option_id === "string" ? ga.item_option_id : null);
  const was = parseFloat(tile.match(/price__price--is-crossed-out[^"]*"\s+data-value="([0-9.]+)"/)?.[1] ?? String(ga.original_price ?? ""));
  const price = parseFloat(tile.match(/price__price--is-on-sale"\s+data-value="([0-9.]+)"/)?.[1] ?? String(ga.price ?? ""));
  if (!id || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const href = tile.match(/<a href="([^"]+)" class="product-tile__link"/)?.[1];
  const name = decodeEntities(tile.match(/<h4 class="product-tile__name">([^<]*)<\/h4>/)?.[1] ?? "").trim();
  if (!href || !name) return null;
  // Each slide's srcset starts with its own photo; take that first URL per slide.
  const imgs = [...tile.matchAll(/data-srcset="(https:\/\/[^\s",]+)/g)].map((m) => decodeEntities(m[1]));
  // Ask the image service for a larger rendition than the 320 px tile.
  const big = (u: string) => u.replace(/\?.*$/, "?sh=1200&sm=fit&sw=800");
  const seen = new Set<string>();
  const gallery = imgs.map(big).filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  const images = cleanGallery(gallery);
  const division = String(ga.item_division ?? "");
  const colour = typeof ga.item_color === "string" && ga.item_color ? ga.item_color : null;
  const style = String(ga.item_id ?? id.split("_")[0]);
  return {
    brand: "wefashion",
    country,
    externalId: id,
    name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: true,
    category: nlType(ga.item_subcategory, ga.item_category, name) ?? (decodeEntities(String(ga.item_subcategory || ga.item_category || "")) || null),
    gender: genderOf(division),
    groupKey: `wefashion-${style}`,
    colorName: colour,
  };
}

/** Register as `listWefashion(country)`. NL, BE. */
export async function listWefashion(country: CountryCode): Promise<ProductRecord[]> {
  const m = WEFASHION_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const cgid of CGIDS) {
    for (let page = 0; byId.size < CAP; page++) {
      if (page >= MAX_PAGES) throw new Error(`wefashion ${country}: ${cgid} has more than ${MAX_PAGES} pages`);
      if (!first) await sleep(PAUSE_MS);
      first = false;
      const html = await getText(wefashionGridUrl(m, cgid, page * PAGE), { country, timeoutMs: 60_000 });
      const tiles = wefashionTiles(html);
      for (const t of tiles) {
        const r = mapWefashionTile(t, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (tiles.length < PAGE) break;
    }
  }
  if (!byId.size) throw new Error(`wefashion ${country}: 0 marked-down tiles`);
  return [...byId.values()].slice(0, CAP);
}
