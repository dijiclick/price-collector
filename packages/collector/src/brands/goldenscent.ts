/**
 * Golden Scent (goldenscent.com) — the Saudi fragrance & beauty shop.
 * KSA is www.goldenscent.com/en, the UAE ae.goldenscent.com/en (the hreflang
 * table on the home page; `/sa-en`, `/ae-en` are 404s).
 *
 * Until 2026-10-16 this read the RSC flight data of the Next.js sale page
 * (`/c/best-sellers/best-sellers-on-sale`). Since then AWS WAF answers every
 * `/c/…` and `/p/…` page with a 202 JS challenge and an empty body — from this
 * Mac and from GitHub's runners alike (probe 39678344011); only the home,
 * search and brand pages still render. So the site itself is no longer read.
 *
 * The Android app (com.goldenscent.c3po, Flutter) talks to the Magento backend
 * directly: `POST gs-api.goldenscent.com/graphql`, no key, the market picked by
 * the `Store` header (`en_sa` → SAR, `en_ae` → AED). It answers runners
 * (same probe). The sale page is Magento category 1955 ("Best Sellers on
 * Sale", ~1,550 in KSA, ~1,500 in the UAE); `pageSize` 300 is honoured, so a
 * run is 6 requests of ~250 KB. SKUs are the ones the site used, so rows keep
 * their ids.
 *
 * `gender`, `brand_new` and `product_type_new2` come back as option ids; the
 * labels are read from the page-1 `aggregations` of the same query.
 *
 * Prices: a configurable product's `minimum_price` pairs the lowest regular
 * price with the lowest final price, which can come from different sizes — a
 * fake markdown. So the was/now pair is taken from ONE variant: the cheapest
 * genuinely reduced size, in stock first. Bundles ("Exclusive Bundles",
 * product type Bundles) are priced against the sum of their parts and are
 * dropped.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const GOLDENSCENT_SITES: Partial<Record<CountryCode, { site: string; store: string }>> = {
  SA: { site: "https://www.goldenscent.com/en", store: "en_sa" },
  AE: { site: "https://ae.goldenscent.com/en", store: "en_ae" },
};
const API = "https://gs-api.goldenscent.com/graphql";
const SALE_CATEGORY = "1955";
const PAGE_SIZE = 300;
const MAX_PAGES = Number(process.env.GOLDENSCENT_MAX_PAGES ?? 8);
const CAP = 1500;

const PRICE = "price_range{minimum_price{regular_price{value currency} final_price{value currency}}}";
export const saleQuery = (page: number) =>
  `{products(filter:{category_id:{eq:"${SALE_CATEGORY}"}},pageSize:${PAGE_SIZE},currentPage:${page}){` +
  `total_count page_info{total_pages}` +
  (page === 1 ? ` aggregations{attribute_code options{label value}}` : "") +
  ` items{__typename sku name url_key stock_status gender brand_new product_type_new2 small_image{url} ${PRICE}` +
  ` ... on ConfigurableProduct{variants{attributes{code label} product{stock_status ${PRICE}}}}}}}`;

/** Option id → label, per attribute, out of the query's aggregations. */
export type Labels = Record<string, Map<string, string>>;
export function labelsOf(aggregations: any[] | undefined): Labels {
  const out: Labels = {};
  for (const a of aggregations ?? []) {
    if (!a?.attribute_code) continue;
    out[a.attribute_code] = new Map((a.options ?? []).map((o: any) => [String(o.value), String(o.label).trim()]));
  }
  return out;
}

/** Label(s) of a select / multiselect attribute value ("19" or "19,20"). */
function labelOf(labels: Labels, code: string, v: unknown): string[] {
  if (v == null || v === "") return [];
  const map = labels[code];
  return String(v)
    .split(",")
    .map((id) => map?.get(id.trim()))
    .filter((l): l is string => !!l);
}

function genderOf(ls: string[]): ProductRecord["gender"] {
  if (ls.includes("Kids")) return "cocuk";
  const women = ls.includes("Women");
  const men = ls.includes("Men");
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return null;
}

type Pair = { price: number; was: number; inStock: boolean };
const pairOf = (pr: any, inStock: boolean): Pair => ({
  price: Number(pr?.minimum_price?.final_price?.value),
  was: Number(pr?.minimum_price?.regular_price?.value),
  inStock,
});

/** Map one Magento product. Pure; null unless genuinely reduced in the market's currency. */
export function mapGoldenScent(p: any, country: CountryCode, labels: Labels = {}): ProductRecord | null {
  const m = GOLDENSCENT_SITES[country];
  if (!m || !p?.sku || !p?.name || !p?.url_key) return null;
  const currency = COUNTRIES[country].currency;
  if (p.price_range?.minimum_price?.final_price?.currency !== currency) return null;
  const brand = labelOf(labels, "brand_new", p.brand_new)[0] ?? "";
  const type = labelOf(labels, "product_type_new2", p.product_type_new2)[0] ?? null;
  if (/bundle/i.test(`${brand} ${type ?? ""}`)) return null;

  const vars: any[] = Array.isArray(p.variants) ? p.variants : [];
  const sizes: SizeVariant[] = [];
  const pairs: Pair[] = [];
  for (const v of vars) {
    const inStock = v?.product?.stock_status === "IN_STOCK";
    const label = String((v?.attributes ?? []).find((a: any) => a?.code === "size_new")?.label ?? "").trim();
    if (label) sizes.push({ label, availability: inStock ? "in_stock" : "out_of_stock" });
    pairs.push(pairOf(v?.product?.price_range, inStock));
  }
  if (!vars.length) pairs.push(pairOf(p.price_range, p.stock_status === "IN_STOCK"));
  const reduced = pairs
    .filter((x) => x.price > 0 && x.was > x.price)
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price);
  const pick = reduced[0] ?? pairs.filter((x) => x.price > 0).sort((a, b) => a.price - b.price)[0];
  if (!pick) return null;

  const img = typeof p.small_image?.url === "string" && !/placeholder/.test(p.small_image.url) ? p.small_image.url : null;
  const name = String(p.name).replace(/\s+/g, " ").trim();
  return {
    brand: "goldenscent",
    country,
    externalId: String(p.sku),
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    url: `${m.site}/p/${p.url_key}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(pick.price),
    listPrice: pick.was > pick.price ? toMinor(pick.was) : null,
    currency,
    inStock: p.stock_status === "IN_STOCK",
    category: type,
    gender: genderOf(labelOf(labels, "gender", p.gender)),
    variants: sizes.length ? { colors: [], sizes } : null,
  };
}

export const brand = "goldenscent";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  const m = GOLDENSCENT_SITES[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let labels: Labels = {};
  let total = 1;
  for (let page = 1; page <= Math.min(total, MAX_PAGES); page++) {
    const res = await getJson<any>(API, {
      method: "POST",
      country,
      timeoutMs: 60_000,
      headers: { "Content-Type": "application/json", Store: m.store },
      body: JSON.stringify({ query: saleQuery(page) }),
    });
    const conn = res?.data?.products;
    if (!conn) throw new Error(`goldenscent/${country}: ${JSON.stringify(res?.errors ?? null).slice(0, 200)}`);
    if (page === 1) {
      total = Number(conn.page_info?.total_pages) || 1;
      labels = labelsOf(conn.aggregations);
    }
    for (const p of conn.items ?? []) {
      const r = mapGoldenScent(p, country, labels);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
