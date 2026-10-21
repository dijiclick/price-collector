/**
 * Magasin du Nord — Denmark's department store (magasin.dk), 2026-10-21.
 *
 * Salesforce Commerce Cloud (Sites-DK-Site) behind Cloudflare. The SFRA grid
 * endpoints (Search-UpdateGrid, /internalsearchpages) are challenged (403), but
 * the category listing pages themselves answer the GitHub runners (probe
 * 39634668018: 200, no proxy):
 *
 *   GET /<dame|herre|skoenhed>/?prefn1=isSale&prefv1=Se%20alle%20tilbudsvarer&page=N
 *
 * `isSale` is the site's own "tilbudsvarer" filter. A page is 36 tiles and
 * ~1.6 MB of HTML (`sz`/`start` are ignored), so each section reads a fixed
 * page budget rather than its whole sale (womens alone is ~9,000 items):
 * ~26 pages, ~40 MB, ~900 rows a run. That budget is deliberate, not a
 * failure; a failed page throws.
 *
 * Each `<product-tile>` carries a GA4 `data-gtm-event` JSON (name, brand,
 * price, original_price, stock_status, category tree, colour); the shown
 * prices are cross-checked against the tile's own sales / strike-through
 * `content` attributes, so a member ("goodie") price never passes.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf } from "./_sfcchtml";

const ORIGIN = "https://www.magasin.dk";
const SECTIONS: { path: string; pages: number; gender: ProductRecord["gender"] }[] = [
  { path: "dame", pages: 12, gender: "kadin" },
  { path: "herre", pages: 8, gender: "erkek" },
  { path: "skoenhed", pages: 6, gender: null },
];
const SALE = "prefn1=isSale&prefv1=Se%20alle%20tilbudsvarer";
const PAUSE_MS = Number(process.env.MAGASIN_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Split a listing page into `<product-tile …>…</product-tile>` blocks. */
export function magasinTiles(html: string): string[] {
  const out: string[] = [];
  const re = /<product-tile[\s\S]*?<\/product-tile>/g;
  for (const m of html.matchAll(re)) out.push(m[0]);
  return out;
}

const contentOf = (tile: string, cls: string): number => {
  const m = tile.match(new RegExp(`class="b-price__el-type ${cls}[^"]*">\\s*<span class="b-price__value value" content="([\\d.]+)"`));
  return m ? parseFloat(m[1]) : NaN;
};

/** Map one product tile. Pure. Returns only real markdowns. */
export function mapMagasin(tile: string, gender: ProductRecord["gender"] = null, country: CountryCode = "DK"): ProductRecord | null {
  const open = tile.slice(0, tile.indexOf(">") + 1);
  const pid = attrOf(open, "data-product-id");
  const ev = jsonOf<any>(attrOf(open, "data-gtm-event") ?? "");
  const it = ev?.ecommerce?.items?.[0];
  const href = tile.match(/<a href="(\/[^"]+\.html)"/)?.[1];
  if (!pid || !it || !href) return null;
  const price = contentOf(tile, "sales");
  const was = contentOf(tile, "strike-through");
  if (!(price > 0) || !(was > price)) return null;
  // The tracked prices must agree with what the tile shows.
  if (Math.abs(Number(it.price) - price) > 0.01 || Math.abs(Number(it.original_price) - was) > 0.01) return null;
  // The tile's own text keeps the shop's casing; the tracking JSON is lower-cased.
  const text = (cls: string) => {
    const m = tile.match(new RegExp(`class="${cls}[^"]*"[^>]*>([^<]*)<`));
    return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  };
  const maker = text("b-productcard__brand-link") || String(it.item_brand ?? "").trim() || null;
  const name = text("b-productcard__name-link") || String(it.item_name ?? "").trim();
  if (!name) return null;
  const src = tile.match(/<img\s+src="([^"]+)"/)?.[1];
  const img = src ? decodeEntities(src).replace(/([?&])sw=\d+/, "$1sw=800") : null;
  const tree = [it.item_category, it.item_category2, it.item_category3, it.item_category4].filter((x) => typeof x === "string" && x);
  const top = tree[0];
  const g = top === "womens" ? "kadin" : top === "mens" ? "erkek" : top === "kids" ? "cocuk" : gender;
  return {
    brand: "magasin",
    country,
    externalId: pid,
    name: maker ? `${maker} ${name}` : name,
    url: `${ORIGIN}${decodeEntities(href)}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: String(it.stock_status ?? "").toLowerCase() === "in stock",
    category: tree.slice(-2).join(" ") || null,
    maker,
    gender: g,
    variants: null,
    colorName: typeof it.item_variant === "string" && it.item_variant ? it.item_variant : null,
    groupKey: typeof it.variant_id === "string" && it.variant_id ? it.variant_id : null,
  };
}

export async function listMagasin(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  if (country !== "DK") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const s of SECTIONS) {
    for (let page = 1; page <= s.pages && byId.size < cap; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await getText(`${ORIGIN}/${s.path}/?${SALE}&page=${page}`, { country, timeoutMs: 45_000 });
      const tiles = magasinTiles(html);
      if (!tiles.length) {
        if (page === 1) throw new Error(`magasin/${country}: ${s.path} sale listing has no tiles`);
        break;
      }
      for (const t of tiles) {
        const r = mapMagasin(t, s.gender, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (tiles.length < 36) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
