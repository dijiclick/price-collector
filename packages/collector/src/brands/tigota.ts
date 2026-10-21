/**
 * Tigotà (tigota.it) — Italy's drugstore chain, EUR. BEAUTY ONLY. Added 2026-10-21.
 *
 * www.tigota.it (Next.js) and its Magento backend `mcprod.tigota.it` sit
 * behind Cloudflare, which refuses browser-shaped requests from our Turkish
 * line and from Hetzner. The backend's Magento GraphQL answers the Android
 * app's OkHttp User-Agent — from the Mac and from a GitHub runner (probe run
 * 39635286410: 200). The UA must be the ONLY user-agent header.
 *
 * - The feed is the "Offerte online" category (id 816, ~2,470 products), the
 *   shop's own online markdowns: `price_range.minimum_price.regular_price`
 *   is the struck price, `final_price` the selling one (guest price — no
 *   loyalty card). Rows with final >= regular are not deals.
 * - Beauty only: a product is kept when it sits in one of BEAUTY's categories
 *   (perfume, make-up, skin care, sun, hair, deodorants, hair removal,
 *   shaving, body wash). Household cleaning, pet food, toilet paper, oral and
 *   intimate hygiene, supplements and baby care are dropped.
 * - Photos: the raw `mcprod` media URLs are walled, but the storefront's own
 *   Next.js image proxy serves them (probe run 39635501014: 200 from a
 *   runner), so imageUrl is `www.tigota.it/_next/image?url=…`. From Turkey and
 *   Germany both answer 403 — CHECK ON AN ITALIAN DEVICE before shipping.
 * - Product page: `https://www.tigota.it/<url_key>` (200 from a runner).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://mcprod.tigota.it/graphql";
const SITE = "https://www.tigota.it";
const UA = "okhttp/4.12.0";
const OFFERS = "816";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const CAP = 1500;
const PAUSE_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Beauty category ids (top level or sub-tree root) → gender when it says so. */
export const BEAUTY: Record<number, ProductRecord["gender"] | undefined> = {
  54: undefined, // Profumi
  55: "kadin", // Profumi > Donna
  58: "erkek", // Profumi > Uomo
  3: undefined, // Make up
  10: undefined, // Cosmesi (viso, corpo)
  1990: undefined, // Solari
  82: undefined, // Capelli
  128: undefined, // Deodoranti
  141: undefined, // Depilazione
  122: "erkek", // Cura Barba
  100: undefined, // Detergenti Corpo
};
/** Categories that are merchandising, not product type (offers, delivery promos, brand pages). */
const NOT_A_TYPE = new Set([2, 816, 2420, 2104, 2116, 2107, 2110, 2113, 2206, 439]);

export const QUERY = `query($cat:String!,$page:Int!,$size:Int!){products(filter:{category_id:{eq:$cat}},pageSize:$size,currentPage:$page){total_count page_info{total_pages current_page} items{sku name url_key stock_status small_image{url} media_gallery{url} price_range{minimum_price{regular_price{value currency} final_price{value}}} categories{id name level}}}}`;

export const imageProxy = (raw: string, w = 640): string =>
  `${SITE}/_next/image?url=${encodeURIComponent(raw.split("?")[0])}&w=${w}&q=75`;

/** Map one product (beauty deals only). Pure. */
export function mapTigota(p: any, country: CountryCode = "IT"): ProductRecord | null {
  const cats: any[] = Array.isArray(p?.categories) ? p.categories : [];
  const ids = cats.map((c) => Number(c?.id));
  if (!ids.some((id) => id in BEAUTY)) return null;
  const mp = p?.price_range?.minimum_price;
  const was = Number(mp?.regular_price?.value);
  const price = Number(mp?.final_price?.value);
  const currency = String(mp?.regular_price?.currency ?? "EUR");
  if (!p?.sku || !p?.name || !p?.url_key) return null;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  let gender: ProductRecord["gender"] = null;
  for (const id of ids) if (BEAUTY[id]) gender = BEAUTY[id]!;
  // Deepest real category name ("Creme Mani", "Mascara") as the type text.
  const typed = cats
    .filter((c) => !NOT_A_TYPE.has(Number(c?.id)) && typeof c?.name === "string")
    .sort((a, b) => Number(b?.level ?? 0) - Number(a?.level ?? 0));
  const gallery = (Array.isArray(p.media_gallery) ? p.media_gallery : [])
    .map((m: any) => (typeof m?.url === "string" ? imageProxy(m.url) : null));
  const first = typeof p?.small_image?.url === "string" ? imageProxy(p.small_image.url) : null;
  const images = cleanGallery(gallery, first);
  return {
    brand: "tigota",
    country,
    externalId: String(p.sku),
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: `${SITE}/${p.url_key}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency,
    inStock: p.stock_status === "IN_STOCK",
    category: typed[0]?.name ?? null,
    gender,
  };
}

/** Register as `listTigota(country)`. IT only. */
export async function listTigota(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IT") return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    if (page > MAX_PAGES) throw new Error(`tigota/${country}: ${pages} pages exceed the budget (${MAX_PAGES})`);
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(API, {
      method: "POST",
      country,
      timeoutMs: 60_000,
      headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { cat: OFFERS, page, size: PAGE_SIZE } }),
    });
    const prods = d?.data?.products;
    if (!prods || !Array.isArray(prods.items)) throw new Error(`tigota/${country}: page ${page} failed: ${JSON.stringify(d?.errors ?? d).slice(0, 200)}`);
    pages = Number(prods.page_info?.total_pages) || 1;
    for (const p of prods.items) {
      const r = mapTigota(p, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
