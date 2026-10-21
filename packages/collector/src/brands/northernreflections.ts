/**
 * Northern Reflections (Canada, northernreflections.com) — 2026-10-21.
 *
 * BigCommerce storefront whose listing pages are served by Searchspring
 * (site id `7bukde`, public — it is in every page as `siteId = "7bukde"`).
 * The Searchspring search API answers a plain GET with no key and no wall:
 *   https://7bukde.a.searchspring.io/api/search/search.json?siteId=7bukde
 *     &resultsFormat=native&bgfilter.ss_on_sale=1&resultsPerPage=100&page=N
 * (the API refuses a request without `page`).
 *
 * `price` is what the shop charges and `msrp` the regular price it strikes
 * through — the PDP's own BCData has `sale_price_without_tax` 59.19 and
 * `non_sale_price_without_tax` 74.00 for the row whose feed says 59.19 / 74.
 * All amounts are CAD (the store sells in Canada only). ~234 sale rows of
 * ~290 live products on 2026-10-21, mostly a "20% off almost everything"
 * event the shop prices into the item itself.
 *
 * Women's brand: every row is `kadin`. No per-size stock in the feed
 * (colour swatches only), so `variants` carries the colour name.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "northernreflections";

const SITE_ID = "7bukde";
const PER_PAGE = 100;
const MAX_PAGES = 15;
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const searchUrl = (page: number) =>
  `https://${SITE_ID}.a.searchspring.io/api/search/search.json?siteId=${SITE_ID}&resultsFormat=native&bgfilter.ss_on_sale=1&resultsPerPage=${PER_PAGE}&page=${page}`;

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const decode = (s: string) => s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

/** The deepest "Apparel>…" / "Accessories>…" shelf, else the product-type word. */
export function categoryOf(hier: unknown, type: unknown): string | null {
  const paths = (Array.isArray(hier) ? hier : []).map((h) => decode(String(h ?? "")));
  const shelf = paths
    .filter((p) => /^(Apparel|Accessories|Footwear|Jewellery|Jewelry|Sleepwear|Activewear)>/i.test(p))
    .sort((a, b) => b.split(">").length - a.split(">").length)[0];
  if (shelf) return shelf.split(">").pop()!.trim();
  return typeof type === "string" && type.trim() ? type.trim() : null;
}

/** One Searchspring result → a record, or null unless it is a real markdown. Pure. */
export function mapNrResult(r: any): ProductRecord | null {
  const id = String(r?.uid ?? r?.id ?? "").trim();
  const name = decode(String(r?.name ?? "")).replace(/\s+/g, " ").trim();
  const url = typeof r?.url === "string" ? r.url : "";
  const price = num(r?.price);
  const was = num(r?.msrp);
  if (!id || !name || !url || price == null || was == null || price >= was) return null;
  const image = typeof r?.imageUrl === "string" && r.imageUrl ? r.imageUrl : null;
  let colour: string | null = null;
  try {
    const sw = JSON.parse(decode(String(r?.ss_swatches ?? "[]")));
    if (Array.isArray(sw) && sw.length === 1 && typeof sw[0]?.color === "string") colour = sw[0].color;
  } catch {
    colour = null;
  }
  return {
    brand,
    country: "CA",
    externalId: id,
    name,
    url: url.replace(/^https:\/\/northernreflections\.com/, "https://www.northernreflections.com"),
    imageUrl: image,
    images: cleanGallery([image], image),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "CAD",
    inStock: String(r?.ss_in_stock ?? "1") === "1",
    category: categoryOf(r?.categories_hierarchy, r?.product_type_unigram),
    gender: "kadin",
    variants: colour ? { colors: [colour], sizes: [] } : null,
    colorName: colour,
  };
}

export async function listNorthernReflections(country: CountryCode = "CA"): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`northernreflections/CA: over ${MAX_PAGES} pages`);
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(searchUrl(page), { country });
    const results: any[] = d?.results ?? [];
    for (const res of results) {
      const r = mapNrResult(res);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    const total = Number(d?.pagination?.totalPages ?? 0);
    if (!results.length || page >= total) break;
  }
  if (!byId.size) throw new Error("northernreflections/CA: no sale rows");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listNorthernReflections;
