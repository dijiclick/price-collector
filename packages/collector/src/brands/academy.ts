/**
 * Academy Sports + Outdoors (academy.com, US only) — sporting goods department
 * store, clearance apparel/footwear only.
 *
 * The site's pages sit behind PerimeterX, but the catalogue lives in Algolia
 * with the app id and search-only key published in the site's own
 * `/static-assets/…/env/environment.prod1east.js` (`ALGOLIA.APP_ID`/`API_KEY`):
 *
 *   POST https://ekmp1kfs6w-dsn.algolia.net/1/indexes/prodlive-products-data/query
 *        { facetFilters: [["facet_Deals:Clearance"], ["primaryCategoryCanonicalUrl.L1.seoToken:womens"]] }
 *
 * Only the fashion sections are read (womens, mens, kids, footwear) — Academy
 * also sells firearms, fishing and fan gear, which never pass this filter.
 *
 * Prices: `defaultSku` carries the "was/now" pair the site shows (`listPrice`,
 * `salePrice`), but a product's colours/sizes can sit at different prices
 * (`minEffectivePrice`..`maxEffectivePrice`). A row is kept only when every SKU
 * sells at one price (min == max == salePrice) below the list price. `sth_oos`
 * is ship-to-home stock; `facet_Brand` is the maker.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "academy";

const SITE = "https://www.academy.com";
const ALGOLIA = "https://ekmp1kfs6w-dsn.algolia.net/1/indexes/prodlive-products-data/query";
const HEADERS = {
  "X-Algolia-Application-Id": "EKMP1KFS6W",
  "X-Algolia-API-Key": "22642137a8bd9574c0365f91b1087e92",
  "Content-Type": "application/json",
};
const CAP = 1500;
const PAUSE_MS = 500;
const ATTRS = [
  "name", "defaultSku", "minEffectivePrice", "maxEffectivePrice", "seoURL", "thumbnail", "sth_oos",
  "facet_Brand", "facet_Gender", "primaryCatgroupName", "sellable", "partNumber",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Section (L1 seo token), our gender, and how many rows it may contribute. */
export const ACADEMY_WALKS: [section: string, gender: ProductRecord["gender"], share: number][] = [
  ["womens", "kadin", 550],
  ["mens", "erkek", 450],
  ["footwear", null, 100],
  ["kids", "cocuk", 400],
];

export const queryBody = (section: string) =>
  JSON.stringify({
    query: "",
    hitsPerPage: 1000,
    page: 0,
    facetFilters: [["facet_Deals:Clearance"], [`primaryCategoryCanonicalUrl.L1.seoToken:${section}`]],
    attributesToRetrieve: ATTRS,
    attributesToHighlight: [],
  });

function genderOf(v: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const g = (Array.isArray(v) ? v : [v]).map(String).join(" ");
  if (/boy|girl|kid|youth|toddler/i.test(g)) return "cocuk";
  if (/women/i.test(g) && !/\bmen'?s?\b/i.test(g.replace(/women/gi, ""))) return "kadin";
  if (/\bmen/i.test(g) && !/women/i.test(g)) return "erkek";
  return fallback;
}

/** Map one Algolia hit. Pure; null unless one price across SKUs, below list. */
export function mapAcademy(h: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = String(h?.objectID ?? h?.partNumber ?? "");
  const name = String(h?.name ?? "").trim();
  if (!id || !name || !h?.seoURL || h?.sellable === "false") return null;
  let ds: any = h.defaultSku;
  if (typeof ds === "string") {
    try { ds = JSON.parse(ds); } catch { return null; }
  }
  const sale = Number(ds?.salePrice);
  const list = Number(ds?.listPrice);
  const lo = Number(h.minEffectivePrice);
  const hi = Number(h.maxEffectivePrice);
  if (!(sale > 0) || !(list > sale) || lo !== hi || lo !== sale) return null;
  const img = typeof h.thumbnail === "string" && h.thumbnail ? `https:${h.thumbnail.replace(/^https?:/, "")}?wid=800&hei=800` : null;
  const make = Array.isArray(h.facet_Brand) ? h.facet_Brand[0] : h.facet_Brand;
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    // The seoURL is the whole path segment; appending the id 404s (916 of 1,000 links, 2026-10-21).
    url: `${SITE}/p/${String(h.seoURL).replace(/-+$/, "")}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: Number(h.sth_oos ?? 0) === 0,
    category: typeof h.primaryCatgroupName === "string" ? h.primaryCatgroupName : null,
    maker: typeof make === "string" && make.trim() ? make.trim() : null,
    gender: genderOf(h.facet_Gender, gender),
    variants: null,
    groupKey: null,
    colorName: typeof ds?.color === "string" ? ds.color : null,
  };
}

export async function listAcademy(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const [section, gender, share] of ACADEMY_WALKS) {
    if (!first) await sleep(PAUSE_MS);
    first = false;
    const d = await getJson<any>(ALGOLIA, { country, method: "POST", headers: HEADERS, body: queryBody(section), retries: 1, timeoutMs: 30_000 });
    const hits: any[] = Array.isArray(d?.hits) ? d.hits : [];
    if (!hits.length && section === "womens") throw new Error("academy: Algolia returned no clearance hits");
    const rows = hits.map((h) => mapAcademy(h, gender)).filter((r): r is ProductRecord => r != null);
    const ranked = [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)];
    let added = 0;
    for (const r of ranked) {
      if (added >= share) break;
      if (!byId.has(r.externalId)) byId.set(r.externalId, r), added++;
    }
  }
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listAcademy;
