/**
 * Vans — Australia (vans.com.au), the brand's own AU store: a Magento 2
 * backend behind a ScandiPWA front end, with the stock Magento GraphQL
 * endpoint at `/graphql` open to a plain browser UA from a GitHub runner
 * (probe 38236127242).
 *
 * vans.com (US/CA, `/en-us`, `/en-ca`) and vans.co.uk / vans.ch are VF's
 * "Canvas" storefront: pages are Akamai-walled and the catalog API
 * (`/api/products/v2/catalog`) sits behind PerimeterX, which lets an odd
 * request through and blocks the rest (probes 38236399455, 38236490538,
 * 38236585893). No search provider key is exposed. Those markets are not
 * collected here.
 *
 * Two passes, because pricing is what makes Magento slow (~55 ms per product):
 *   1. The Sale category (id 33, ~3,075 configurable products) asking only
 *      `sku stock_status` — 1,000 per request, ~1.3 s each. About one in six is
 *      in stock; the rest are sold-out leftovers.
 *   2. Full detail (prices, per-size stock, gallery) for the in-stock SKUs only,
 *      100 per request via `filter:{sku:{in:[…]}}`.
 * Whole run ≈ 10 requests, ~1 min.
 *
 * Prices (AUD): `price_range.minimum_price.final_price` against its
 * `regular_price` — Magento's own was/now pair. Kept only when final < regular.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "vans";

const SITES: Partial<Record<CountryCode, { origin: string; saleCategory: string; currency: string }>> = {
  AU: { origin: "https://www.vans.com.au", saleCategory: "33", currency: "AUD" },
};
const CAP = 1500;
const LIST_PAGE = 1000;
const DETAIL_BATCH = 100;

export const listQuery = (category: string, page: number) =>
  `{products(filter:{category_id:{eq:"${category}"}},pageSize:${LIST_PAGE},currentPage:${page}){total_count page_info{total_pages} items{sku stock_status}}}`;

export const detailQuery = (skus: string[]) =>
  `{products(filter:{sku:{in:${JSON.stringify(skus)}}},pageSize:${skus.length}){items{__typename sku name url_key url_suffix stock_status small_image{url} media_gallery{url position disabled} categories{url_path} price_range{minimum_price{regular_price{value currency} final_price{value}}} ... on ConfigurableProduct{variants{attributes{code label} product{stock_status}}}}}}`;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function genderOf(paths: string[]): ProductRecord["gender"] {
  const p = paths.join(" ");
  if (/\bkids\b|\/kids|girls|boys/.test(p)) return "cocuk";
  const w = /womens/.test(p);
  const m = /(^|[/\s])mens/.test(p);
  return w && !m ? "kadin" : m && !w ? "erkek" : null;
}

const SIZE_CODES = new Set(["apparel21_size_code", "size"]);

/** Map one detail item. Pure; null unless genuinely reduced. */
export function mapVans(x: any, country: CountryCode = "AU"): ProductRecord | null {
  const site = SITES[country];
  if (!site || !x?.sku || !x?.name || !x?.url_key) return null;
  const min = x?.price_range?.minimum_price;
  const now = num(min?.final_price?.value);
  const was = num(min?.regular_price?.value);
  if (now == null || was == null || now >= was) return null;

  const gallery = ((x.media_gallery ?? []) as any[])
    .filter((m) => m && !m.disabled && typeof m.url === "string" && /\.(jpe?g|png|webp)$/i.test(m.url))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((m) => m.url as string);
  const first = (typeof x.small_image?.url === "string" && /\.(jpe?g|png|webp)$/i.test(x.small_image.url) ? x.small_image.url : null) ?? gallery[0] ?? null;

  const sizes: SizeVariant[] = [];
  const colors = new Set<string>();
  for (const v of (x.variants ?? []) as any[]) {
    const attrs: any[] = v?.attributes ?? [];
    const size = attrs.find((a) => SIZE_CODES.has(a?.code))?.label;
    const color = attrs.find((a) => a?.code === "color")?.label;
    if (color) colors.add(String(color));
    if (size == null || sizes.some((s) => s.label === String(size))) continue;
    sizes.push({ label: String(size), availability: v?.product?.stock_status === "IN_STOCK" ? "in_stock" : "out_of_stock" });
  }
  const inStock = sizes.length ? sizes.some((s) => s.availability === "in_stock") : x.stock_status === "IN_STOCK";
  const paths = ((x.categories ?? []) as any[]).map((c) => String(c?.url_path ?? "")).filter(Boolean);
  const leaf = paths.filter((p) => p.startsWith("sale/")).sort((a, b) => b.length - a.length)[0];

  return {
    brand,
    country,
    externalId: String(x.sku),
    name: String(x.name).trim(),
    url: `${site.origin}/${x.url_key}${x.url_suffix ?? ".html"}`,
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: site.currency,
    inStock,
    category: leaf ? leaf.split("/").pop()!.replace(/-/g, " ") : null,
    gender: genderOf(paths),
    variants: sizes.length || colors.size ? { colors: [...colors], sizes } : null,
    groupKey: String(x.sku).split(".")[0] || null,
    colorName: colors.size === 1 ? [...colors][0] : null,
  };
}

async function gql(origin: string, query: string, country: CountryCode): Promise<any> {
  const d = await getJson<any>(`${origin}/graphql`, {
    method: "POST",
    body: JSON.stringify({ query }),
    headers: { "Content-Type": "application/json", Store: "default", Referer: `${origin}/` },
    country,
    timeoutMs: 60_000,
  });
  if (!d?.data?.products) throw new Error(`vans/${country}: graphql answered ${JSON.stringify(d).slice(0, 200)}`);
  return d.data.products;
}

export async function listVans(country: CountryCode): Promise<ProductRecord[]> {
  const site = SITES[country];
  if (!site) return [];

  // Pass 1: which sale SKUs are in stock.
  const inStock: string[] = [];
  let seen = 0;
  for (let page = 1, pages = 1; page <= pages && page <= 6; page++) {
    const p = await gql(site.origin, listQuery(site.saleCategory, page), country);
    pages = Number(p?.page_info?.total_pages ?? 1);
    for (const it of p.items ?? []) {
      if (!it?.sku) continue;
      seen++;
      if (it.stock_status === "IN_STOCK") inStock.push(String(it.sku));
    }
  }

  // Pass 2: prices, sizes and photos for the in-stock ones.
  const byId = new Map<string, ProductRecord>();
  const skus = [...new Set(inStock)].slice(0, CAP);
  for (let i = 0; i < skus.length; i += DETAIL_BATCH) {
    const p = await gql(site.origin, detailQuery(skus.slice(i, i + DETAIL_BATCH)), country);
    for (const it of p.items ?? []) {
      const r = it ? mapVans(it, country) : null;
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error(`vans/${country}: 0 discounted products (${seen} sale SKUs, ${skus.length} in stock)`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listVans;
