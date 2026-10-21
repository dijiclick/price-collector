/**
 * Boots UK (boots.com; the Gulf shops are boots.ts) through the Algolia index its own search box queries.
 *
 * www.boots.com is behind Imperva ("Pardon Our Interruption" to every
 * scripted request), but the product catalogue is an Algolia index with a
 * public search-only key printed in the page as `algoliaConfig`
 * (`appID` 89JDFPR8F6, index `prod_live_products_uk`, 2026-10-11). Algolia's
 * `*-dsn.algolia.net` hosts are not behind the site's wall, and this index
 * allows paging past Algolia's usual 1,000-hit limit.
 *
 * Algolia cannot filter on `currentPrice < regularPrice`, so the in-stock
 * beauty / fragrance / toiletries catalogue is paged through (~25 pages of
 * 1,000 with a trimmed attribute list) and the reduced rows kept. A
 * "Worth £X" gift-set value is not a price anyone was ever charged, so those
 * rows are dropped — only a real was-price or RRP counts. Deepest discounts
 * first, capped.
 *
 * Products are single SKUs (one shade = one row, grouped by `parentProduct`),
 * so there are no per-size variants.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "boots";

const APP_ID = "89JDFPR8F6";
const API_KEY = "39ae8989d71b15b23524d9408047414f"; // public search-only key from boots.com's algoliaConfig
const INDEX = "prod_live_products_uk";
const SITE = "https://www.boots.com";
const CAP = 1500;
const MAX_PAGES = 40;
const PAUSE_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ireland (boots.ie, EUR; 2026-10-21): the same Algolia app holds a sister
 * index `prod_live_products_ie` (~61k entries) with EUR `currentPrice` /
 * `regularPrice` and `wasPriceText_ROI`. boots.ie is Imperva-walled like
 * boots.com; the index is not (probe run 39634392109). Beauty and fragrance
 * only — toiletries, health and electrical (straighteners,
 * shavers) are left out for Ireland.
 */
const IE_INDEX = "prod_live_products_ie";
const IE_SITE = "https://www.boots.ie";
export const FILTER_IE =
  '(categoryMap.categories.lvl0:"beauty & skincare" OR categoryMap.categories.lvl0:"fragrance") AND ' +
  'NOT categoryMap.categories.lvl0:"baby & child" AND NOT categoryMap.categories.lvl0:"electrical" AND ' +
  'NOT categoryMap.categories.lvl0:"health & pharmacy" AND NOT categoryMap.categories.lvl0:"homeware" AND ' +
  'NOT brand:Chanel AND liveFlag:true AND inStock:true';

/** The site's own default filter, narrowed to the departments the app covers and to stock. */
export const FILTER =
  '(categoryMap.categories.lvl0:"beauty & skincare" OR categoryMap.categories.lvl0:"fragrance" OR ' +
  'categoryMap.categories.lvl0:"toiletries") AND NOT categoryMap.categories.lvl0:"baby & child" AND ' +
  'NOT brand:Chanel AND liveFlag:true AND inStock:true';

const ATTRS = [
  "objectID", "model", "parentProduct", "brand", "offerName", "actionURL", "referenceImageURL",
  "currentPrice", "regularPrice", "inStock", "productColour", "categoryMap",
  "productAttributes.gender", "productAttributes.wasPriceText_UK", "productAttributes.product_type",
].join(",");
const ATTRS_IE = ATTRS.replace("productAttributes.wasPriceText_UK", "productAttributes.wasPriceText_ROI");

export function pageUrl(page: number): string {
  const p = new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    page: String(page),
    filters: FILTER,
    attributesToRetrieve: ATTRS,
    attributesToHighlight: "",
    "x-algolia-application-id": APP_ID,
    "x-algolia-api-key": API_KEY,
  });
  return `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}?${p}`;
}

export function pageUrlIe(page: number): string {
  const p = new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    page: String(page),
    filters: FILTER_IE,
    attributesToRetrieve: ATTRS_IE,
    attributesToHighlight: "",
    "x-algolia-application-id": APP_ID,
    "x-algolia-api-key": API_KEY,
  });
  return `https://${APP_ID}-dsn.algolia.net/1/indexes/${IE_INDEX}?${p}`;
}

/** Algolia stores single-valued attributes as a bare string and multi-valued ones as an array. */
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === "string");

function genderOf(g: unknown): ProductRecord["gender"] {
  const set = new Set(list(g).map((x) => x.toLowerCase()));
  if (set.has("unisex") || set.size === 0) return null;
  const women = set.has("womens");
  const men = set.has("mens");
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  if (!women && !men && [...set].some((x) => /girl|boy|kid|baby/.test(x))) return "cocuk";
  return null;
}

/** Map one Algolia hit. Pure; null unless it is a genuine reduction. */
export function mapBootsGb(h: any, country: CountryCode = "GB"): ProductRecord | null {
  const price = Number(h?.currentPrice);
  const was = Number(h?.regularPrice);
  if (!h?.objectID || !h?.offerName || !h?.actionURL) return null;
  if (!(price > 0) || !(was > price)) return null;
  const ie = country === "IE";
  const wasText = ie ? h?.productAttributes?.wasPriceText_ROI : h?.productAttributes?.wasPriceText_UK;
  if (String(wasText ?? "").toLowerCase() === "worth") return null;
  const img = h.model ? `https://boots.scene7.com/is/image/Boots/${h.model}?wid=800&hei=800&op_sharpen=1` : null;
  const cats = h?.categoryMap?.["categories.lvl3"] ?? h?.categoryMap?.["categories.lvl2"] ?? [];
  const type = h?.productAttributes?.product_type;
  return {
    brand,
    country,
    externalId: String(h.objectID),
    name: String(h.offerName).trim(),
    url: `${ie ? IE_SITE : SITE}${h.actionURL}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: ie ? "EUR" : "GBP",
    inStock: h.inStock !== false,
    // product_type lists merchandising shelves too ("star gift"); skip those.
    category: list(type).find((t) => !/gift/i.test(t)) || cats[0] || null,
    gender: genderOf(h?.productAttributes?.gender),
    variants: null,
    groupKey: h.parentProduct ? `boots:${h.parentProduct}` : null,
    colorName: typeof h.productColour === "string" && h.productColour.trim() ? h.productColour.trim() : null,
  };
}

export async function listBootsGb(country: CountryCode = "GB"): Promise<ProductRecord[]> {
  if (country === "IE") return listBootsIe();
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(pageUrl(page), { country });
    const hits: any[] = d?.hits ?? [];
    for (const h of hits) {
      const r = mapBootsGb(h, country);
      if (r) byId.set(r.externalId, r);
    }
    if (hits.length < 1000) break;
  }
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  return [...byId.values()].sort((a, b) => off(b) - off(a)).slice(0, CAP);
}

async function listBootsIe(): Promise<ProductRecord[]> {
  const country: CountryCode = "IE";
  const byId = new Map<string, ProductRecord>();
  let page = 0;
  for (; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(pageUrlIe(page), { country });
    const hits: any[] = d?.hits;
    if (!Array.isArray(hits)) throw new Error(`boots/IE: page ${page} has no hits`);
    for (const h of hits) {
      const r = mapBootsGb(h, country);
      if (r) byId.set(r.externalId, r);
    }
    if (hits.length < 1000) break;
  }
  if (page === MAX_PAGES) throw new Error(`boots/IE: more than ${MAX_PAGES} pages`);
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  return [...byId.values()].sort((a, b) => off(b) - off(a)).slice(0, CAP);
}
