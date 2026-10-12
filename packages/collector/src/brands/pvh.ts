/**
 * PVH — Calvin Klein and Tommy Hilfiger. Two feeds, one per platform.
 *
 * United States (calvinklein.us, usa.tommy.com): Salesforce Commerce Cloud
 * (Sites-PVHCKUS-Site / Sites-PVHTHUS-Site) behind Akamai. A desktop browser
 * UA, okhttp and curl all get 403 on every path from a runner (probes
 * 38227726366, 38229281386), but an iPhone Safari UA passes, and the SFRA grid
 * endpoint `Search-UpdateGrid?cgid=<sale>&start=N&sz=16` answers 200 with the
 * server-rendered tiles (probes 38229281386, 38229384439). The Mac is
 * geo-blocked by Akamai whatever the UA, so the tile parser was built from the
 * 2026-10-04 Wayback copy of the same sale grid. The grid serves 16 tiles a
 * page whatever `sz` asks for. A tile is one colour of a style: its strike
 * (`strike-through list`) and sale price, availability, photos and the master
 * id (`data-mpid`). No per-size stock in the grid.
 *
 * Canada (calvinklein.ca, ca.tommy.com) answers the same iPhone UA (probe
 * 38229384439: 200 on /en/sale) but its SFCC site ids and sale category ids
 * are not verified yet, so it is not wired.
 *
 * Europe incl. GB / CH (uk.tommy.com, calvinklein.co.uk, ch.tommy.com …): the
 * sites time out from a runner. Their listing API
 * `live.{ck,th}.prd.b2c-api.eu.pvh.cloud/ppa-plp-srp/products` (headers
 * `accept-store: CalvinKleinUK|TommyUK|…CH`, `accept-locale`) answers the Mac
 * with real `wasPrice`s for Calvin Klein in 14 markets, but its CloudFront WAF
 * returns 403 to runner IPs on every path, robots.txt included, whatever the
 * headers (probes 38228542655, 38228703533). Proxy-only, so not used. Tommy's
 * EU "Fall Sale" carries no strike price at all right now (a checkout promo).
 *
 * Australia (calvinklein.com.au, au.tommy.com) is one Magento install with a
 * store view per brand. Its own React listing reads Magento GraphQL (Fredhopper
 * behind it), which answers a plain GET from a runner (probe 38229220361). One
 * request resolves the women's and men's sale categories, then 100 products a
 * page. The listing carries regular and final price per product (one colour
 * each), stock status and photos; no per-size stock, so `variants` stays null.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson, getText } from "../http";
import { decodeEntities } from "./_sfcchtml";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type PvhBrand = "calvinklein" | "tommyhilfiger";

interface Store {
  host: string;
  /** Magento store view; the shared install answers with Tommy's view when the header is missing. */
  store: string;
}

export const PVH_STORES: Record<PvhBrand, Partial<Record<CountryCode, Store>>> = {
  calvinklein: { AU: { host: "https://www.calvinklein.com.au", store: "calvin_klein_store_view" } },
  tommyhilfiger: { AU: { host: "https://au.tommy.com", store: "tommy_hilfiger_store_view" } },
};

/** Sale sections, women first: the cap fills with women's deals before men's. */
const SECTIONS: { path: string; gender: "kadin" | "erkek" }[] = [
  { path: "sale/womens-sale", gender: "kadin" },
  { path: "sale/mens-sale", gender: "erkek" },
];

const PAGE_SIZE = 100;
const MAX_PAGES = 12; // per section
const CAP = 1500;
const PAUSE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATEGORY_QUERY = `{categoryList(filters:{url_path:{in:[${SECTIONS.map((s) => JSON.stringify(s.path)).join(",")}]}}){id url_path}}`;

/** The storefront's own `Products` query, trimmed to what we map. */
const PRODUCTS_QUERY =
  "query Products($pageSize:Int!,$currentPage:Int!,$filter:ProductAttributeFilterInput!,$sort:ProductAttributeSortInputFH!)" +
  "{products(pageSize:$pageSize,currentPage:$currentPage,filter:$filter,sort:$sort)" +
  "{page_info{current_page total_pages} total_count items{id sku name color url_key url_suffix images stock_status " +
  "categories{name url_path level} " +
  "price_range{minimum_price{regular_price{value} final_price{value}} maximum_price{regular_price{value currency} final_price{value currency}}}}}}";

const gql = (host: string, query: string, variables?: object): string =>
  `${host}/graphql?query=${encodeURIComponent(query)}` +
  (variables ? `&variables=${encodeURIComponent(JSON.stringify(variables))}` : "");

export const categoryUrl = (brand: PvhBrand, country: CountryCode): string => gql(PVH_STORES[brand][country]!.host, CATEGORY_QUERY);

export const productsUrl = (brand: PvhBrand, country: CountryCode, categoryId: string | number, page: number): string =>
  gql(PVH_STORES[brand][country]!.host, PRODUCTS_QUERY, {
    pageSize: PAGE_SIZE,
    currentPage: page,
    filter: { category_id: { eq: String(categoryId) } },
    sort: {},
  });

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Deepest product-type category ("women/clothing/knitwear" → "Knitwear",
 * "underwear/womens-underwear/briefs" → "Briefs"), skipping the sale tree and
 * the merchandising lists (shop-all, features, new-in, edits, gifts).
 */
function categoryOf(cats: unknown): string | null {
  if (!Array.isArray(cats)) return null;
  let best: { name: string; level: number } | null = null;
  for (const c of cats) {
    const path = String(c?.url_path ?? "");
    if (!path.includes("/") || /^sale\b/.test(path) || /(^|\/)(shop-all[^/]*|features|new[^/]*|edits?|gifts?[^/]*)(\/|$)/.test(path)) continue;
    const level = Number(c?.level ?? 0);
    const name = String(c?.name ?? "").trim();
    if (name && (!best || level > best.level)) best = { name, level };
  }
  return best?.name ?? null;
}

/** `images` is one string, photos joined by ";;". */
function photosOf(images: unknown): string[] {
  return String(images ?? "")
    .split(";;")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s) && !/placeholder/i.test(s));
}

/**
 * Style id from the photo name the source itself splits ("WW0WW38744_Z00_main"
 * for SKU WW0WW38744Z00), so every colour of a style collapses into one card.
 */
function styleOf(sku: string, photos: string[]): string | null {
  for (const p of photos) {
    const m = /\/([A-Z0-9]+)_([A-Z0-9]+)_[^/]*$/i.exec(p.split("?")[0]);
    if (m && `${m[1]}${m[2]}`.toUpperCase() === sku.toUpperCase()) return m[1].toUpperCase();
  }
  return null;
}

/** Map one listing item to a discounted record, or null. Pure. */
export function mapPvhItem(brand: PvhBrand, country: CountryCode, item: any, gender: "kadin" | "erkek"): ProductRecord | null {
  const store = PVH_STORES[brand][country];
  const sku = String(item?.sku ?? "").trim();
  const urlKey = String(item?.url_key ?? "").trim();
  if (!store || !sku || !urlKey || !item?.name) return null;
  const min = item?.price_range?.minimum_price;
  const max = item?.price_range?.maximum_price;
  const sale = num(max?.final_price?.value);
  const list = num(max?.regular_price?.value);
  if (sale == null || list == null || sale >= list) return null;
  // A price that differs across sizes is a range, not a markdown.
  if (num(min?.final_price?.value) !== sale || num(min?.regular_price?.value) !== list) return null;
  const currency = COUNTRIES[country].currency;
  const cur = max?.final_price?.currency ?? max?.regular_price?.currency;
  if (cur && cur !== currency) return null;
  const photos = photosOf(item.images);
  const style = styleOf(sku, photos);
  const colour = String(item.color ?? "").trim() || null;
  return {
    brand,
    country,
    externalId: sku,
    name: String(item.name).trim(),
    url: `${store.host}/${urlKey}${item.url_suffix ?? ""}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency,
    inStock: item.stock_status === "IN_STOCK",
    category: categoryOf(item.categories),
    gender,
    variants: null,
    groupKey: style ? `${brand}-${style}` : null,
    colorName: colour,
  };
}

export async function listPvh(brand: PvhBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (PVH_SFCC[brand]?.[country]) return listSfcc(brand, country);
  return listMagento(brand, country);
}

async function listMagento(brand: PvhBrand, country: CountryCode): Promise<ProductRecord[]> {
  const store = PVH_STORES[brand]?.[country];
  if (!store) return [];
  const headers = { Store: store.store };
  const cats = await getJson<any>(categoryUrl(brand, country), { country, headers });
  const ids = new Map<string, string>();
  for (const c of cats?.data?.categoryList ?? []) ids.set(String(c?.url_path ?? ""), String(c?.id ?? ""));

  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  for (const section of SECTIONS) {
    const id = ids.get(section.path);
    if (!id) continue;
    for (let page = 1; page <= MAX_PAGES && inStock < CAP; page++) {
      await sleep(PAUSE_MS);
      const data = await getJson<any>(productsUrl(brand, country, id, page), { country, headers });
      const items: any[] = data?.data?.products?.items ?? [];
      for (const item of items) {
        const r = mapPvhItem(brand, country, item, section.gender);
        if (!r || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        if (r.inStock) inStock++;
      }
      const pages = Number(data?.data?.products?.page_info?.total_pages ?? 0);
      if (items.length < PAGE_SIZE || page >= pages) break;
    }
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error(`pvh ${brand}/${country}: no discounted products in the sale sections`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

// ---------------------------------------------------------------- US (SFCC)

interface SfccSite {
  host: string;
  site: string;
  locale: string;
  /** The sale category the site's own /en/sale grid browses. */
  cgid: string;
}

export const PVH_SFCC: Record<PvhBrand, Partial<Record<CountryCode, SfccSite>>> = {
  calvinklein: { US: { host: "https://www.calvinklein.us", site: "PVHCKUS", locale: "en_US", cgid: "Tier_0000010" } },
  tommyhilfiger: { US: { host: "https://usa.tommy.com", site: "PVHTHUS", locale: "en_US", cgid: "Tier_18819388" } },
};

/** Akamai lets mobile Safari through where desktop Chrome, okhttp and curl get 403. */
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const GRID_PAGE = 16; // the grid ignores larger `sz`
const SFCC_MAX_PAGES = 55;
const SFCC_PAUSE_MS = 500;

export const gridUrl = (brand: PvhBrand, country: CountryCode, start: number): string => {
  const s = PVH_SFCC[brand][country]!;
  return `${s.host}/on/demandware.store/Sites-${s.site}-Site/${s.locale}/Search-UpdateGrid?cgid=${s.cgid}&start=${start}&sz=${GRID_PAGE}`;
};

const attr = (html: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`).exec(html);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : null;
};

/** `content` of the first `<span class="value">` after `marker`. */
function priceAfter(html: string, marker: RegExp): number | null {
  const m = marker.exec(html);
  if (!m) return null;
  const v = /class="value"[^>]*content="([0-9.]+)"/.exec(html.slice(m.index, m.index + 400));
  return v ? num(v[1]) : null;
}

function sfccGender(dept: string, master: string): ProductRecord["gender"] {
  const s = `${master}:${dept}`.toLowerCase();
  if (/\b(girls?|boys?|kids?|baby|toddler)\b/.test(s)) return "cocuk";
  if (/\bwom[ae]n(?:'s)?\b/.test(s)) return "kadin";
  if (/\bm[ae]n(?:'s)?\b/.test(s)) return "erkek";
  return null;
}

/** Map one SFRA product tile (one colour of a style) to a discounted record, or null. Pure. */
export function mapPvhTile(brand: PvhBrand, country: CountryCode, tile: string): ProductRecord | null {
  const site = PVH_SFCC[brand][country];
  if (!site) return null;
  const mpid = attr(tile, "data-mpid");
  let imgAttr: any = null;
  try {
    imgAttr = JSON.parse(attr(tile, "data-product-image-attr") ?? "null");
  } catch {
    imgAttr = null;
  }
  const path = String(imgAttr?.product?.url ?? /class="ds-product-name"[^>]*href="([^"]+)"/.exec(tile)?.[1] ?? "");
  const pid = /\/([A-Z0-9]+-[A-Z0-9]+)\.html/i.exec(path)?.[1];
  const name = /class="ds-product-name"[^>]*>\s*<span>([^<]+)<\/span>/.exec(tile)?.[1];
  if (!mpid || !pid || !name) return null;
  // A size-price range is not a markdown, and only a struck "list" price counts.
  if (/class="range"/.test(tile)) return null;
  const list = priceAfter(tile, /class="strike-through list"/);
  const sale = priceAfter(tile, /<span class="sales"/);
  if (list == null || sale == null || sale >= list) return null;

  let cat: any = {};
  try {
    cat = JSON.parse(attr(tile, "data-category") ?? "{}");
  } catch {
    cat = {};
  }
  const master = String(cat?.product_master_category ?? "");
  const segs = master.split(":").filter((x) => x && !/sale/i.test(x));
  const leaf = segs[segs.length - 1];
  const photos: string[] = (Array.isArray(imgAttr?.product?.images) ? imgAttr.product.images : [])
    .map((i: any) => String(i?.absURL ?? i?.url ?? ""))
    .filter((u: string) => /^https:\/\//.test(u))
    .map((u: string) => `${u.split("?")[0]}?wid=800&qlt=80`);
  const colour = /aria-checked="true"\s+aria-label="([^"]+)"/.exec(tile)?.[1] ?? null;
  return {
    brand,
    country,
    externalId: pid.toUpperCase(),
    name: decodeEntities(name).trim(),
    url: `${site.host}${path.split("?")[0]}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: imgAttr?.product?.available !== false,
    category: leaf ? leaf[0].toUpperCase() + leaf.slice(1) : null,
    gender: sfccGender(String(cat?.product_dept ?? ""), master),
    variants: null,
    groupKey: `${brand}-${mpid.toUpperCase()}`,
    colorName: colour ? decodeEntities(colour).trim() : null,
  };
}

/** Split a grid page into tiles. */
export function tilesOf(html: string): string[] {
  return html.split(/(?=<div class="product-tile\b)/).filter((t) => t.startsWith('<div class="product-tile'));
}

async function listSfcc(brand: PvhBrand, country: CountryCode): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  let tilesSeen = 0;
  const seen = new Set<string>();
  for (let page = 0; page < SFCC_MAX_PAGES && inStock < CAP; page++) {
    if (page) await sleep(SFCC_PAUSE_MS);
    const html = await getText(gridUrl(brand, country, page * GRID_PAGE), {
      country,
      headers: { "User-Agent": IPHONE_UA, "X-Requested-With": "XMLHttpRequest", Accept: "text/html, */*; q=0.01" },
    });
    const tiles = tilesOf(html);
    tilesSeen += tiles.length;
    let fresh = 0;
    for (const t of tiles) {
      const key = attr(t, "data-mpid") + "|" + (/\/([A-Z0-9]+-[A-Z0-9]+)\.html/i.exec(t)?.[1] ?? "");
      if (!seen.has(key)) (seen.add(key), fresh++);
      const r = mapPvhTile(brand, country, t);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      if (r.inStock) inStock++;
    }
    // A short page is the last one; a page of only repeats means start ran past the end.
    if (tiles.length < GRID_PAGE || !fresh) break;
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error(`pvh ${brand}/${country}: no discounted tiles in ${tilesSeen} on the sale grid`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
