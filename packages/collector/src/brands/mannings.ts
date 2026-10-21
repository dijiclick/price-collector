/**
 * Mannings (Hong Kong health & beauty chain, DFI Retail), 2026-10-21.
 *
 * mannings.com.hk is Magento PWA Studio, and its public GraphQL endpoint
 * (`/graphql`, GET, no key, no cookie) answers the storefront's own product
 * queries in English (store `en_US`, HKD). No page is read, no proxy.
 *
 * Scope: the Beauty, Hair and Personal Care trees (`category_url_path`) —
 * Health Care (medicines), Mom & Baby (formula), Food and Household are left
 * out. Magento cannot filter on a discount, so each tree is paged in full
 * (200 a page, ~22 requests for ~4,400 products) and only products whose
 * `final_price` is below `regular_price` are kept: Magento's catalogue special
 * price, the strikethrough every guest sees — member (MPlus) offers are not in
 * these fields.
 */
import { type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "mannings";

const API = "https://www.mannings.com.hk/graphql";
const SITE = "https://www.mannings.com.hk/en";
export const MANNINGS_TREES = ["beauty", "hair", "personal-care"];
const PAGE = 200;
const MAX_PAGES = 20;
const PAUSE_MS = 400;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function query(tree: string, page: number): string {
  return (
    `{products(filter:{category_url_path:{eq:"${tree}"}},pageSize:${PAGE},currentPage:${page}){` +
    `total_count page_info{total_pages} items{sku name url_key stock_status small_image{url} ` +
    `categories{name url_path} price_range{minimum_price{regular_price{value currency} final_price{value currency}}}}}}`
  );
}

/** Map one GraphQL product. Pure; null unless reduced. */
export function mapItem(it: any, country: CountryCode = "HK"): ProductRecord | null {
  const mp = it?.price_range?.minimum_price;
  const price = Number(mp?.final_price?.value);
  const was = Number(mp?.regular_price?.value);
  if (!it?.sku || !it?.name || !it?.url_key) return null;
  if (!(price > 0 && was > price)) return null;
  const cur = mp?.final_price?.currency;
  if (cur && cur !== "HKD") throw new Error(`mannings/${country}: priced in ${cur}`);
  const image = typeof it.small_image?.url === "string" && !/placeholder/i.test(it.small_image.url)
    ? it.small_image.url.replace(/\?.*$/, "")
    : null;
  // Deepest category wins: "beauty/cleanser" → "Cleanser".
  const cats: any[] = (it.categories ?? []).filter((c: any) => typeof c?.url_path === "string");
  const leaf = cats.sort((a, b) => b.url_path.split("/").length - a.url_path.split("/").length)[0];
  return {
    brand,
    country,
    externalId: String(it.sku),
    name: String(it.name).trim(),
    url: `${SITE}/${it.url_key}`,
    imageUrl: image,
    images: image ? [image] : null,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "HKD",
    inStock: it.stock_status !== "OUT_OF_STOCK",
    category: leaf?.name ?? null,
    gender: null,
    variants: null,
  };
}

export async function listMannings(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "HK") return [];
  const byId = new Map<string, ProductRecord>();
  // The three trees run side by side (one request in flight each): a 200-item
  // page takes ~6 s server-side, so one after another would brush the 3-minute budget.
  await Promise.all(
    MANNINGS_TREES.map(async (tree) => {
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        if (page > MAX_PAGES) throw new Error(`mannings/${country}: ${tree} has over ${MAX_PAGES} pages`);
        if (page > 1) await sleep(PAUSE_MS);
        const d = await getJson<any>(`${API}?query=${encodeURIComponent(query(tree, page))}`, {
          country,
          headers: { Store: "en_US" },
        });
        const p = d?.data?.products;
        if (!Array.isArray(p?.items)) {
          throw new Error(`mannings/${country}: ${tree} page ${page} failed: ${JSON.stringify(d?.errors ?? null).slice(0, 200)}`);
        }
        pages = Number(p.page_info?.total_pages ?? 1);
        for (const it of p.items) {
          const r = mapItem(it, country);
          if (r) byId.set(r.externalId, r);
        }
      }
    }),
  );
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
