/**
 * Gulf storefronts on Salesforce Commerce Cloud (SFRA), read from the grid
 * fragment their own "show more" button loads — `Search-UpdateGrid` with
 * `X-Requested-With: XMLHttpRequest`, 96 tiles a call. Measured 2026-11-10,
 * every grid answered a GitHub runner (probe run 42802047681):
 *
 * - Galeries Lafayette Dubai (galerieslafayette.ae): luxury department store —
 *   Marc Jacobs, Ganni, Maje, Sandro, Kenzo, Balmain… `prefn1=isSale&prefv1=
 *   On Sale` is the site's own sale filter (its menu links to it); the women's
 *   list is 3,000+ tiles deep. Each tile's `data-gtm` carries the name, the
 *   brand (→ `maker`), the price charged and the discount amount in AED.
 * - GAP (gap.ae, gap.sa, gap.com.kw — Al Tayer): `cgid=sale-women|sale-men`.
 *   The tile's impression JSON carries the list price and the discount amount
 *   in the market's currency (AED / SAR / KWD).
 * - Banana Republic (bananarepublic.ae): the GAP template, `cgid=sale-women|
 *   sale-men`, AED.
 * - The Deal (thedealoutlet.com/ae-en, /sa-en): Chalhoub's designer outlet on
 *   the same tile template; the tile's `item_brand` is the maker.
 * - GUESS (guess.ae, guess.sa): same template; `sale-uae-*` / `sale-ksa-*`.
 * - Lacoste (lacoste.ae, .sa, .qa): same template; `Lacoste_Outlet_Women|Men`.
 * - Under Armour (underarmour.ae, underarmour.sa): `cgid=outlet`; the tile's
 *   wishlist JSON carries `list_price` / `sale_price` and the gender.
 *
 * The tile JSON states its currency; a tile in another currency than the
 * market's is dropped, so a geo-switched page can never store a wrong price.
 * Grid tiles are buyable products (sold-out ones drop out of the grid) and
 * carry no per-size stock, so no size variants.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export type SfraGulfBrand = "galerieslafayette" | "gap" | "bananarepublic" | "underarmour" | "thedealoutlet" | "guess" | "lacoste";
type Gender = ProductRecord["gender"];

interface Tile {
  id: string;
  name: string;
  href: string;
  image: string | null;
  now: number;
  was: number;
  currency: string;
  maker?: string | null;
  gender?: Gender;
  category?: string | null;
  colorName?: string | null;
}
interface Market {
  origin: string;
  /** `Sites-<id>-Site/<locale>` */
  site: string;
  locale: string;
}
interface Site {
  markets: Partial<Record<CountryCode, Market>>;
  /** Grid query per section (without start/sz), its gender and its share of the cap. */
  sections: Section[] | ((country: CountryCode) => Section[]);
  parse: (tile: string) => Tile | null;
  /** Tiles per call when the storefront ignores `sz` (GUESS answers 20 whatever is asked). */
  pageSize?: number;
}
interface Section { query: string; gender: Gender; max: number }

const PAGE = 96;
const PAUSE_MS = Number(process.env.SFRA_GULF_PAUSE_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The JSON held in an HTML attribute of a tile, or null. */
function attrJson(tile: string, attr: string): any {
  const m = tile.match(new RegExp(`${attr}="([^"]*)"`));
  if (!m) return null;
  try { return JSON.parse(decodeEntities(m[1])); } catch { return null; }
}
const firstHref = (tile: string): string | null => {
  const m = tile.match(/<a[^>]*href="(\/[^"]+?\.html)(?:\?[^"]*)?"/);
  return m ? decodeEntities(m[1]) : null;
};
/** The first catalogue image of the tile, at a feed-sized rendition. */
function firstImage(tile: string, size: string): string | null {
  const m = tile.match(/(?:src|srcset|data-href|data-src)="(https:\/\/[^"\s]+\/dw\/image\/[^"\s?]+)/);
  return m ? `${decodeEntities(m[1])}?${size}` : null;
}
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseGl(tile: string): Tile | null {
  const g = attrJson(tile, "data-gtm")?.GA4?.ecommerce;
  const it = g?.items?.[0];
  const href = firstHref(tile);
  if (!it?.item_id || !it?.item_name || !href) return null;
  const now = Number(it.price);
  const off = Number(it.discount);
  return {
    id: String(it.item_id), name: String(it.item_name).trim(), href, image: firstImage(tile, "sw=800&sh=870"),
    now, was: off > 0 ? round2(now + off) : now, currency: String(g.currency ?? "").toUpperCase(),
    maker: typeof it.item_brand === "string" && it.item_brand.trim() ? it.item_brand.trim() : null,
    gender: /^women$/i.test(it.item_category ?? "") ? "kadin" : /^men$/i.test(it.item_category ?? "") ? "erkek" : /kid|baby/i.test(it.item_category ?? "") ? "cocuk" : undefined,
    category: [it.item_category4, it.item_category3, it.item_category2].find((c) => typeof c === "string" && c.trim()) ?? null,
  };
}

export function parseGap(tile: string): Tile | null {
  const it = attrJson(tile, "data-gtm-enhancedecommerce-impression")?.[0];
  const href = firstHref(tile);
  if (!it?.item_id || !it?.item_name || !href || it.item_in_stock === false) return null;
  const was = Number(it.price);
  const off = Number(it.discount);
  const cat = String(it.item_category ?? "").toLowerCase();
  const leaf = String(it.item_category3 || it.item_category2 || "").replace(/^(women|men|girls|boys|baby|toddler)-/, "").replace(/-/g, " ").trim();
  return {
    id: String(it.item_id), name: String(it.item_name).trim(), href, image: firstImage(tile, "sw=800&sh=1067"),
    now: off > 0 ? round2(was - off) : was, was, currency: String(it.currency ?? "").toUpperCase(),
    gender: /girl|boy|baby|toddler|kid/.test(cat) ? "cocuk" : cat === "women" ? "kadin" : cat === "men" ? "erkek" : undefined,
    category: leaf ? leaf.charAt(0).toUpperCase() + leaf.slice(1) : null,
    colorName: typeof it.item_color === "string" ? it.item_color.replace(/^\d+-/, "").replace(/-/g, " ") : null,
  };
}

/** GUESS Gulf: the same template; its colour is a code ("F6ZP"), not a name. */
export function parseGuess(tile: string): Tile | null {
  const t = parseGap(tile);
  return t ? { ...t, colorName: null } : null;
}

/** Lacoste Gulf: the same template; category and colour are internal codes. */
export function parseLacoste(tile: string): Tile | null {
  const t = parseGap(tile);
  return t ? { ...t, colorName: null, category: null, gender: undefined } : null;
}

/** The Deal Outlet: GAP's tile template on a multi-brand store — the brand is the maker, categories are codes. */
export function parseDeal(tile: string): Tile | null {
  const t = parseGap(tile);
  if (!t) return null;
  const brand = attrJson(tile, "data-gtm-enhancedecommerce-impression")?.[0]?.item_brand;
  return { ...t, category: null, colorName: null, maker: typeof brand === "string" && brand.trim() ? brand.trim() : null };
}

export function parseUa(tile: string): Tile | null {
  const m = tile.match(/class="js-moe-wishlistdata" value="([^"]*)"/);
  let d: any = null;
  try { d = m ? JSON.parse(decodeEntities(m[1])) : null; } catch { d = null; }
  const href = firstHref(tile);
  if (!d?.sku_id || !d?.product_name || !href) return null;
  const g = String(d.prod_gender ?? "").toLowerCase();
  return {
    id: String(d.sku_id), name: String(d.product_name).trim(), href, image: firstImage(tile, "sw=800&sh=1000&sm=fit"),
    now: Number(d.sale_price), was: Number(d.list_price), currency: String(d.currency ?? "").toUpperCase(),
    gender: /kid|boy|girl|youth/.test(`${g} ${d.kids_gender ?? ""}`) && d.kids_gender ? "cocuk" : g === "womens" ? "kadin" : g === "mens" ? "erkek" : undefined,
    category: typeof d.ah2 === "string" && d.ah2 ? titleCase(d.ah2) : null,
    colorName: typeof d.vendor_color === "string" ? d.vendor_color.replace(/\s*\/\s*\/\s*/g, " / ").trim() : null,
  };
}

const SALE_REFINE = "prefn1=isSale&prefv1=On%20Sale";
export const SFRA_GULF: Record<SfraGulfBrand, Site> = {
  galerieslafayette: {
    markets: { AE: { origin: "https://www.galerieslafayette.ae", site: "Sites-GL-Site", locale: "en_AE" } },
    sections: [
      { query: `cgid=women&${SALE_REFINE}`, gender: "kadin", max: 1200 },
      { query: `cgid=men&${SALE_REFINE}`, gender: "erkek", max: 400 },
    ],
    parse: parseGl,
  },
  gap: {
    markets: {
      AE: { origin: "https://www.gap.ae", site: "Sites-GAP_AE-Site", locale: "en_AE" },
      SA: { origin: "https://www.gap.sa", site: "Sites-GAP_SA-Site", locale: "en_SA" },
      KW: { origin: "https://www.gap.com.kw", site: "Sites-GAP_KW-Site", locale: "en_KW" },
    },
    sections: [
      { query: "cgid=sale-women", gender: "kadin", max: 900 },
      { query: "cgid=sale-men", gender: "erkek", max: 500 },
    ],
    parse: parseGap,
  },
  // Banana Republic UAE: the same Al Tayer storefront template as GAP (no SA shop; the KW site has no sale grid).
  bananarepublic: {
    markets: { AE: { origin: "https://www.bananarepublic.ae", site: "Sites-BananaRepublic_AE-Site", locale: "en_AE" } },
    sections: [
      { query: "cgid=sale-women", gender: "kadin", max: 700 },
      { query: "cgid=sale-men", gender: "erkek", max: 400 },
    ],
    parse: parseGap,
  },
  // The Deal (thedealoutlet.com): Chalhoub Group's own designer outlet — Tory
  // Burch, Michael Kors, Kenzo, Karl Lagerfeld, Ferragamo, Versace, Lacoste…
  // The category ids are the ones its own category pages request.
  thedealoutlet: {
    markets: {
      AE: { origin: "https://www.thedealoutlet.com", site: "Sites-TheDealOutlet_AE-Site", locale: "en_AE" },
      SA: { origin: "https://www.thedealoutlet.com", site: "Sites-TheDealOutlet_SA-Site", locale: "en_SA" },
    },
    sections: [
      { query: "cgid=D011000", gender: "kadin", max: 600 }, // women / clothing
      { query: "cgid=D012000", gender: "kadin", max: 400 }, // women / shoes
      { query: "cgid=D013000", gender: "kadin", max: 300 }, // women / bags
      { query: "cgid=D014000", gender: "kadin", max: 150 }, // women / accessories
      { query: "cgid=D016000", gender: null, max: 150 }, // beauty
      { query: "cgid=D021000", gender: "erkek", max: 200 }, // men / clothing
      { query: "cgid=D022000", gender: "erkek", max: 200 }, // men / shoes
    ],
    parse: parseDeal,
  },
  // GUESS UAE / KSA (guess.ae, guess.sa — Chalhoub): the sale tree is named per
  // market (`sale-uae-…`, `sale-ksa-…`) and the grid answers 20 tiles a call.
  guess: {
    markets: {
      AE: { origin: "https://www.guess.ae", site: "Sites-Guess_AE-Site", locale: "en_AE" },
      SA: { origin: "https://www.guess.sa", site: "Sites-Guess_SA-Site", locale: "en_SA" },
    },
    sections: (c) => (c === "SA"
      ? [
          { query: "cgid=sale-ksa-women-view-all", gender: "kadin", max: 500 },
          { query: "cgid=sale-ksa-bags-view-all", gender: "kadin", max: 240 },
          { query: "cgid=sale-ksa-men-view-all", gender: "erkek", max: 160 },
        ]
      : [
          { query: "cgid=sale-uae-women-view-all", gender: "kadin", max: 500 },
          { query: "cgid=sale-uae-view-all-bags", gender: "kadin", max: 240 },
          { query: "cgid=sale-uae-mens-view-all", gender: "erkek", max: 160 },
        ]),
    parse: parseGuess,
    pageSize: 20,
  },
  // Lacoste UAE / KSA / Qatar (lacoste.ae, .sa, .qa — Chalhoub): the site's own
  // Outlet tree. Qatar is small (51 tiles on 2026-11-10).
  lacoste: {
    markets: {
      AE: { origin: "https://www.lacoste.ae", site: "Sites-Lacoste_AE-Site", locale: "en_AE" },
      SA: { origin: "https://www.lacoste.sa", site: "Sites-Lacoste_SA-Site", locale: "en_SA" },
      QA: { origin: "https://www.lacoste.qa", site: "Sites-Lacoste_QA-Site", locale: "en_QA" },
    },
    sections: [
      { query: "cgid=Lacoste_Outlet_Women", gender: "kadin", max: 500 },
      { query: "cgid=Lacoste_Outlet_Men", gender: "erkek", max: 500 },
    ],
    parse: parseLacoste,
  },
  underarmour: {
    markets: {
      AE: { origin: "https://www.underarmour.ae", site: "Sites-UnderArmour_AE-Site", locale: "en_AE" },
      SA: { origin: "https://www.underarmour.sa", site: "Sites-UnderArmour_SA-Site", locale: "en_SA" },
    },
    sections: [{ query: "cgid=outlet", gender: null, max: 1200 }],
    parse: parseUa,
  },
};

export function gridUrl(m: Market, query: string, start: number, size = PAGE): string {
  return `${m.origin}/on/demandware.store/${m.site}/${m.locale}/Search-UpdateGrid?${query}&start=${start}&sz=${size}`;
}

/** The tile wrapper: a div whose class list has the word `product` ("product", "product js-…", "js-… product "). */
const TILE_OPEN = /<div class="(?:[\w-]+ )*product(?: [\w-]*)*"[^>]*data-pid=/;
const TILE_START = new RegExp(`^${TILE_OPEN.source}`);

/** Split a grid fragment into product tiles. Pure. */
export function splitTiles(html: string): string[] {
  return html.split(new RegExp(`(?=${TILE_OPEN.source})`)).filter((t) => TILE_START.test(t));
}

/** Map one tile. Pure; null unless it is a markdown in the market's currency. */
export function mapSfraGulf(brand: SfraGulfBrand, country: CountryCode, tile: string, sectionGender: Gender): ProductRecord | null {
  const site = SFRA_GULF[brand];
  const m = site.markets[country];
  const t = m ? site.parse(tile) : null;
  if (!m || !t) return null;
  const currency = COUNTRIES[country].currency;
  if (t.currency !== currency) return null;
  if (!(t.now > 0) || !(t.was > t.now)) return null;
  return {
    brand,
    country,
    externalId: t.id,
    name: t.name,
    url: `${m.origin}${t.href}`,
    imageUrl: t.image,
    images: cleanGallery([t.image], t.image),
    price: toMinor(t.now),
    listPrice: toMinor(t.was),
    currency,
    inStock: true,
    category: t.category ?? null,
    ...(t.maker ? { maker: t.maker } : {}),
    gender: t.gender ?? sectionGender,
    variants: null,
    groupKey: null,
    colorName: t.colorName ?? null,
  };
}

export async function listSfraGulf(brand: SfraGulfBrand, country: CountryCode): Promise<ProductRecord[]> {
  const site = SFRA_GULF[brand];
  const m = site.markets[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let tilesSeen = 0;
  const size = site.pageSize ?? PAGE;
  const sections = typeof site.sections === "function" ? site.sections(country) : site.sections;
  for (const s of sections) {
    let kept = 0;
    const pages = Math.ceil(s.max / size) + 2;
    for (let p = 0; p < pages && kept < s.max; p++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await getText(gridUrl(m, s.query, p * size, size), {
        country, retries: 2, timeoutMs: 60_000, headers: { "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*" },
      });
      const tiles = splitTiles(html);
      tilesSeen += tiles.length;
      for (const tile of tiles) {
        if (kept >= s.max) break;
        const r = mapSfraGulf(brand, country, tile, s.gender);
        if (!r || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        kept++;
      }
      if (tiles.length < size) break;
    }
  }
  if (!tilesSeen) throw new Error(`${brand}/${country}: the sale grid returned no tiles`);
  return [...byId.values()];
}
