/**
 * River Island UK (riverisland.com), GBP — through the GraphQL aggregator its
 * own Next.js frontend talks to (`api-v2.riverisland.com/graphql`, the
 * `aggregatorUri` in the page's Apollo state). No key, no cookie. 2026-10-11.
 *
 * Two queries, both copied from the site's bundle:
 * - `productsAndFacets(path: "women/sale", pageSize: 200)` — the sale listing
 *   with `ListPrice` (now) and `OriginalPrice` (was) per product.
 * - `product(productId)` — per-size `inventoryQuantity`. The listing's own
 *   `variants` is always null, so sizes come from this one, batched as ~60
 *   aliased fields per request (one POST answers in under a second).
 *
 * The aggregator refuses an anonymous operation ("Context creation failed …
 * countryCode") — an `operationName` is what makes it build its context.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.riverisland.com";
const API = "https://api-v2.riverisland.com/graphql";
const PAGE_SIZE = 200;
const CAP = 1500;
const BATCH = 60;
const LOW = 3;
const PAUSE_MS = Number(process.env.RIVERISLAND_PAUSE_MS ?? 700);
/** Sale trees, in priority order. */
export const RI_PATHS: { path: string; gender: ProductRecord["gender"] }[] = [{ path: "women/sale", gender: "kadin" }];
/**
 * Ireland (2026-10-21): the same aggregator builds an EUR context when the
 * operation's VARIABLES carry `countryCode`/`currencyCode`/`host` (what the
 * site's own /ie pages send) — no header or cookie does it. Product URLs then
 * come back under `/ie/p/…` and prices in EUR (probe run 39634392109).
 */
export const RI_PATHS_IE: { path: string; gender: ProductRecord["gender"] }[] = [
  { path: "women/sale", gender: "kadin" },
  { path: "men/sale", gender: "erkek" },
];
const IE_CONTEXT = { countryCode: "IE", currencyCode: "EUR", host: "www.riverisland.com" };

const LIST_QUERY = `query ProductsAndFacets($isSearch: Boolean!, $keyword: String, $pageSize: Int, $page: Int, $path: String, $refinementsQuery: String, $sort: String) {
  productsAndFacets(isSearch: $isSearch, keyword: $keyword, pageSize: $pageSize, page: $page, path: $path, refinementsQuery: $refinementsQuery, sort: $sort) {
    __typename
    ... on ProductListingData {
      totalCount
      listProducts {
        hasPriceRange productId displayName productPageUrl isComingSoon
        images { url type }
        priceInfo { currencyCode prices { name value } }
        trackingCategoriesInfo { categories }
        attributes { brands }
      }
    }
  }
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { "Content-Type": "application/json", Origin: SITE, Referer: `${SITE}/` };

async function gql<T = any>(operationName: string, query: string, variables: object = {}, country: CountryCode = "GB"): Promise<T> {
  const res = await getJson<any>(API, {
    method: "POST",
    country,
    headers: HEADERS,
    body: JSON.stringify({ operationName, query, variables }),
  });
  if (!res?.data) throw new Error(`riverisland: ${JSON.stringify(res?.errors ?? res).slice(0, 200)}`);
  return res.data as T;
}

export function sizeQuery(ids: string[], countryCode = "GB", currencyCode = "GBP"): string {
  const fields = ids
    .map(
      (id, i) =>
        `p${i}: product(productId: ${JSON.stringify(id)}, countryCode: "${countryCode}", currencyCode: "${currencyCode}") { ... on Product { productId variants { inventoryQuantity displayName dimensions { name value } } } }`,
    )
    .join("\n");
  return `query product {\n${fields}\n}`;
}

/** "10 short (UK)" → "10 Short". */
const sizeLabel = (v: any): string => {
  const raw = String(v?.displayName ?? "").replace(/\s*\(UK\)\s*$/i, "").trim() ||
    (v?.dimensions ?? []).map((d: any) => d?.value).filter(Boolean).join(" ");
  return raw.replace(/\b([a-z])/g, (c: string) => c.toUpperCase());
};

/** Per-size availability from one `product` answer. Pure. */
export function sizesOf(product: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of product?.variants ?? []) {
    const label = sizeLabel(v);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(v?.inventoryQuantity) || 0;
    out.push({ label, availability: q <= 0 ? "out_of_stock" : q <= LOW ? "low_on_stock" : "in_stock" });
  }
  return out;
}

/** Map one listing product. Pure. Sizes are attached afterwards. */
export function mapRiverIsland(p: any, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const prices: Record<string, number> = {};
  for (const x of p?.priceInfo?.prices ?? []) if (x?.name) prices[x.name] = Number(x.value);
  const price = prices.ListPrice;
  const was = prices.OriginalPrice;
  if (!p?.productId || !p?.displayName || !p?.productPageUrl || !Number.isFinite(price) || price <= 0) return null;
  if (p.hasPriceRange || p.isComingSoon) return null;
  const imgs: string[] = (p.images ?? [])
    .slice()
    .sort((a: any, b: any) => Number(b?.type === "Main") - Number(a?.type === "Main"))
    .map((im: any) => im?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const cats: string[] = p.trackingCategoriesInfo?.categories ?? [];
  return {
    brand: "riverisland",
    country,
    externalId: String(p.productId),
    name: String(p.displayName).trim(),
    url: SITE + p.productPageUrl,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: cats.length > 1 ? String(cats[cats.length - 1]) : null,
    gender,
    variants: null,
  };
}

export async function listRiverIsland(country: CountryCode): Promise<ProductRecord[]> {
  if (country === "IE") return listRiverIslandIe();
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const { path, gender } of RI_PATHS) {
    for (let page = 1; byId.size < CAP; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const data = await gql("ProductsAndFacets", LIST_QUERY, {
        isSearch: false, keyword: "", page, pageSize: PAGE_SIZE, path, refinementsQuery: "", sort: "",
      });
      const pf = data?.productsAndFacets;
      const rows: any[] = pf?.listProducts ?? [];
      for (const p of rows) {
        const r = mapRiverIsland(p, country, gender);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
        if (byId.size >= CAP) break;
      }
      if (rows.length < PAGE_SIZE || page * PAGE_SIZE >= Number(pf?.totalCount ?? 0)) break;
    }
  }

  // Per-size stock, batched. A failed batch leaves those rows without sizes.
  const all = [...byId.values()];
  for (let i = 0; i < all.length; i += BATCH) {
    await sleep(PAUSE_MS);
    const chunk = all.slice(i, i + BATCH);
    const data = await gql<Record<string, any>>("product", sizeQuery(chunk.map((r) => r.externalId))).catch(() => null);
    if (!data) continue;
    chunk.forEach((r, j) => {
      const sizes = sizesOf(data[`p${j}`]);
      if (!sizes.length) return;
      r.variants = { colors: [], sizes };
      r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
    });
  }
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}

/** Ireland: the GB flow with the EUR context in every operation's variables. */
async function listRiverIslandIe(): Promise<ProductRecord[]> {
  const country: CountryCode = "IE";
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const { path, gender } of RI_PATHS_IE) {
    for (let page = 1; byId.size < CAP; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      if (requests > 30) throw new Error("riverisland/IE: listing request budget spent");
      const data = await gql("ProductsAndFacets", LIST_QUERY, {
        isSearch: false, keyword: "", page, pageSize: PAGE_SIZE, path, refinementsQuery: "", sort: "", ...IE_CONTEXT,
      }, country);
      const pf = data?.productsAndFacets;
      const rows: any[] = pf?.listProducts ?? [];
      if (page === 1 && !rows.length) throw new Error(`riverisland/IE: empty listing for ${path}`);
      for (const p of rows) {
        if (p?.priceInfo?.currencyCode !== "EUR") throw new Error(`riverisland/IE: listing answered in ${p?.priceInfo?.currencyCode}`);
        const r = mapRiverIsland(p, country, gender);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
        if (byId.size >= CAP) break;
      }
      if (rows.length < PAGE_SIZE || page * PAGE_SIZE >= Number(pf?.totalCount ?? 0)) break;
    }
  }

  const all = [...byId.values()];
  for (let i = 0; i < all.length; i += BATCH) {
    await sleep(PAUSE_MS);
    const chunk = all.slice(i, i + BATCH);
    const data = await gql<Record<string, any>>("product", sizeQuery(chunk.map((r) => r.externalId), "IE", "EUR"), IE_CONTEXT, country).catch(() => null);
    if (!data) continue;
    chunk.forEach((r, j) => {
      const sizes = sizesOf(data[`p${j}`]);
      if (!sizes.length) return;
      r.variants = { colors: [], sizes };
      r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
    });
  }
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}
