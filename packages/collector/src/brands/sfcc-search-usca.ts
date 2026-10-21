/**
 * Two Canadian stores whose listings come from a hosted search API with a
 * public key in the storefront page (measured 2026-10-21; no proxy needed):
 *
 * - Michael Hill (michaelhill.ca, SFCC headless/Nuxt): Constructor.io, the
 *   `constructorApiKeyCaEn` key from `window.__NUXT__.config`. The "sale"
 *   browse group (373 styles) returns `price.amount` (charged) and
 *   `price.retailPrice` (struck) in CAD per style. Read once per gender facet
 *   (Ladies / Mens / Unisex) so every row carries its section. The "Unlock 25%
 *   as a Member" promotion is a member price and is not used.
 * - Ricki's (rickis.com, BigCommerce): SearchSpring site `p74kq1`. The "Sale"
 *   category (576 of 1,175 products) carries `price` and `msrp`; the price
 *   already includes the "Extra 30% off applied" the product page shows.
 *   Women's only.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export type SearchUscaBrand = "michaelhill" | "rickis";

const PAUSE_MS = Number(process.env.SEARCH_USCA_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

// ─── Michael Hill (Constructor.io) ─────────────────────────────────────────

export const MH_HOST = "https://www.michaelhill.ca";
const MH_KEY = "key_96F2Jto3eRccQGKB"; // public storefront key (constructorApiKeyCaEn)
const MH_GENDERS: [facet: string, gender: ProductRecord["gender"]][] = [
  ["Ladies", "kadin"],
  ["Mens", "erkek"],
  ["Unisex", null],
];

export const mhBrowseUrl = (gender: string, page: number) =>
  `https://ac.cnstrc.com/browse/group_id/sale?key=${MH_KEY}&c=ciojs-client-2.0&num_results_per_page=200&page=${page}` +
  `&filters%5Bgender%5D=${encodeURIComponent(gender)}`;

const facet = (data: any, name: string): string | null => {
  const f = (data?.facets ?? []).find((x: any) => x?.name === name);
  const v = Array.isArray(f?.values) ? f.values[0] : null;
  return v == null ? null : String(v);
};

/** One Constructor result → record (real markdowns only). Pure. */
export function mapMichaelHill(res: any, gender: ProductRecord["gender"], country: CountryCode = "CA"): ProductRecord | null {
  const d = res?.data;
  const now = num(d?.price?.amount);
  const was = num(d?.price?.retailPrice);
  if (!d?.id || !res?.value || !d?.url || !(now > 0) || !(was > now)) return null;
  if (d.price.currency && d.price.currency !== COUNTRIES[country].currency) return null;
  const u = d.image_urls ?? {};
  const imgs = [u.image ?? d.image_url, u.image3, u.image4, u.image5, u.lifestyleImage]
    .filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
    .map((x) => (/^https?:/.test(x) ? x : `${MH_HOST}${x}`));
  const ats = num(facet(d, "inventoryATS"));
  return {
    brand: "michaelhill",
    country,
    externalId: String(d.variation_id ?? d.id),
    name: String(res.value).replace(/\s+/g, " ").trim(),
    url: `${MH_HOST}${d.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: Number.isFinite(ats) ? ats > 0 : true,
    category: facet(d, "mHJSubCategory") ?? facet(d, "mHJPrimaryCategory"),
    gender,
    variants: null,
    groupKey: d.id ? `michaelhill:${d.id}` : null,
    colorName: facet(d, "metalColour"),
  };
}

async function listMichaelHill(country: CountryCode): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const [g, gender] of MH_GENDERS) {
    for (let page = 1; page <= 5; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(mhBrowseUrl(g, page), { country });
      const results: any[] = data?.response?.results;
      if (!Array.isArray(results)) throw new Error(`michaelhill/${country}: Constructor page ${page} (${g}) has no results`);
      for (const r of results) {
        const rec = mapMichaelHill(r, gender, country);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      const total = Number(data.response.total_num_results ?? 0);
      if (results.length < 200 || page * 200 >= total) break;
    }
  }
  return [...byId.values()];
}

// ─── Ricki's (SearchSpring) ────────────────────────────────────────────────

export const RICKIS_HOST = "https://rickis.com";
const SS_SITE = "p74kq1";
const SS_PAGE = 100;

export const rickisSearchUrl = (page: number) =>
  `https://${SS_SITE}.a.searchspring.io/api/search/search.json?siteId=${SS_SITE}&resultsFormat=native` +
  `&resultsPerPage=${SS_PAGE}&page=${page}&bgfilter.categories_hierarchy=Sale`;

/** One SearchSpring result → record (real markdowns only). Pure. */
export function mapRickis(r: any, country: CountryCode = "CA"): ProductRecord | null {
  const now = num(r?.price);
  const was = num(r?.msrp);
  if (!r?.uid || !r?.name || !r?.url || !(now > 0) || !(was > now)) return null;
  if (/gift ?card/i.test(String(r.name))) return null;
  const imgs = [r.imageUrl ?? r.ss_image, r.ss_image_hover].filter((x: unknown): x is string => typeof x === "string" && x.startsWith("http"));
  const cats: string[] = Array.isArray(r.categories) ? r.categories.map((c: unknown) => decodeEntities(String(c))) : [];
  const category = cats.find((c) => !/^(sale|shop by category|clothing|new)$/i.test(c)) ?? null;
  return {
    brand: "rickis",
    country,
    externalId: String(r.uid),
    name: decodeEntities(String(r.name)).replace(/\s+/g, " ").trim(),
    url: `${RICKIS_HOST}${r.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: String(r.ss_in_stock ?? "1") === "1",
    category,
    gender: "kadin",
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

async function listRickis(country: CountryCode): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= 15; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(rickisSearchUrl(page), { country });
    const results: any[] = data?.results;
    if (!Array.isArray(results)) throw new Error(`rickis/${country}: SearchSpring page ${page} has no results`);
    for (const r of results) {
      const rec = mapRickis(r, country);
      if (rec) byId.set(rec.externalId, rec);
    }
    if (page >= Number(data?.pagination?.totalPages ?? 0)) break;
  }
  return [...byId.values()];
}

/** Register as `listSearchUsca("michaelhill" | "rickis", country)`. Canada only. */
export async function listSearchUsca(brand: SearchUscaBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const all = brand === "michaelhill" ? await listMichaelHill(country) : await listRickis(country);
  if (!all.length) throw new Error(`${brand}/${country}: no discounted rows`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}
