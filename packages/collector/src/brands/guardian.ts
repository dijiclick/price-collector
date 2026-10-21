/**
 * Guardian (Singapore health & beauty chain, DFI Retail — Mannings' sister),
 * 2026-10-21.
 *
 * guardian.com.sg is a Magento storefront; its public GraphQL endpoint
 * (`/graphql`, GET, no key, no cookie) answers the site's own product queries
 * in SGD. No page is read, no proxy.
 *
 * Scope: the Skin Care, Makeup, Personal Care, Hair Care and Men's Care trees
 * — Health (medicines, supplements), Baby and Household are left out. Two
 * quirks shape the crawl:
 * - Every `products` query stops at 500 hits (`total_count` reads 500 however
 *   big the category is), so the walk goes down the category tree (one
 *   `categoryList` call) to categories under 500 products and pages those.
 *   A leaf at 500+ cannot be split further and throws.
 * - Magento cannot filter on a discount, so every product in scope is read and
 *   only those with `final_price` below `regular_price` are kept — the
 *   catalogue special price every guest sees.
 */
import { type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "guardian";

const API = "https://guardian.com.sg/graphql";
const SITE = "https://guardian.com.sg";
export const GUARDIAN_TREES = ["skin-care", "makeup", "personal-care", "hair-care", "mens-care"];
const WINDOW = 500; // the search engine's hard result window
const PAGE = 200;
const MAX_REQUESTS = 90;
const PAUSE_MS = 300;
const CONCURRENCY = 4;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cat {
  uid: string;
  name: string;
  url_path?: string;
  product_count: number;
  children?: Cat[];
}

const TREE_QUERY =
  `{categoryList(filters:{url_path:{in:${JSON.stringify(GUARDIAN_TREES)}}}){uid name url_path product_count ` +
  `children{uid name product_count children{uid name product_count children{uid name product_count}}}}}`;

/** Categories to page: the shallowest ones under the 500-hit window. Pure. */
export function pickCategories(roots: Cat[]): Cat[] {
  const out: Cat[] = [];
  const walk = (c: Cat) => {
    if (c.product_count <= 0) return;
    if (c.product_count < WINDOW) return void out.push(c);
    const kids = (c.children ?? []).filter((k) => k.product_count > 0);
    if (!kids.length) throw new Error(`guardian: category "${c.name}" has ${c.product_count} products and no subcategories to split it`);
    kids.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

export function productsQuery(uid: string, page: number): string {
  return (
    `{products(filter:{category_uid:{eq:"${uid}"}},pageSize:${PAGE},currentPage:${page}){` +
    `total_count page_info{total_pages} items{sku name url_key url_suffix stock_status small_image{url} ` +
    `price_range{minimum_price{regular_price{value currency} final_price{value currency}}}}}}`
  );
}

/** Map one GraphQL product. Pure; null unless reduced. */
export function mapItem(it: any, category: string | null, country: CountryCode = "SG"): ProductRecord | null {
  const mp = it?.price_range?.minimum_price;
  const price = Number(mp?.final_price?.value);
  const was = Number(mp?.regular_price?.value);
  if (!it?.sku || !it?.name || !it?.url_key) return null;
  if (!(price > 0 && was > price)) return null;
  const cur = mp?.final_price?.currency;
  if (cur && cur !== "SGD") throw new Error(`guardian/${country}: priced in ${cur}`);
  const image = typeof it.small_image?.url === "string" && !/placeholder/i.test(it.small_image.url)
    ? it.small_image.url.replace(/\?.*$/, "")
    : null;
  return {
    brand,
    country,
    externalId: String(it.sku),
    name: String(it.name).trim(),
    url: `${SITE}/${it.url_key}${it.url_suffix ?? ".html"}`,
    imageUrl: image,
    images: image ? [image] : null,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "SGD",
    inStock: it.stock_status !== "OUT_OF_STOCK",
    category,
    gender: null,
    variants: null,
  };
}

const gql = (q: string, country: CountryCode) => getJson<any>(`${API}?query=${encodeURIComponent(q)}`, { country });

export async function listGuardian(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "SG") return [];
  const tree = await gql(TREE_QUERY, country);
  const roots: Cat[] | undefined = tree?.data?.categoryList;
  if (!Array.isArray(roots) || roots.length !== GUARDIAN_TREES.length) {
    throw new Error(`guardian/${country}: category tree incomplete (${roots?.length ?? 0} of ${GUARDIAN_TREES.length} roots)`);
  }
  const cats = pickCategories(roots);
  const byId = new Map<string, ProductRecord>();
  let requests = 1;
  // A 200-item page takes ~5 s server-side and there are ~50 categories, so
  // four run side by side (one request in flight each) to stay well under 3 min.
  let next = 0;
  const worker = async () => {
    while (next < cats.length) {
      const cat = cats[next++];
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        if (++requests > MAX_REQUESTS) throw new Error(`guardian/${country}: over ${MAX_REQUESTS} requests`);
        await sleep(PAUSE_MS);
        const d = await gql(productsQuery(cat.uid, page), country);
        const p = d?.data?.products;
        if (!Array.isArray(p?.items)) throw new Error(`guardian/${country}: "${cat.name}" page ${page} failed`);
        if (Number(p.total_count) >= WINDOW) throw new Error(`guardian/${country}: "${cat.name}" hit the ${WINDOW}-result window`);
        pages = Number(p.page_info?.total_pages ?? 1);
        for (const it of p.items) {
          const r = mapItem(it, cat.name, country);
          if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
