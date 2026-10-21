/**
 * Boscov's (boscovs.com, US only) — family-owned department store, clearance only.
 *
 * Boscov's runs on Kibo Commerce (Mozu). Category pages render no products;
 * the browser loads them from the storefront search API on the same host:
 *
 *   GET https://www.boscovs.com/api/commerce/catalog/storefront/productsearch/search/
 *       ?filter=categoryId req <id>&pageSize=200&startIndex=N
 *
 * with the `x-vol-*` headers the page itself publishes (`data-mz-preload-
 * apicontext`: tenant 30471, site 51049) and the anonymous session cookies
 * (`sb-sf-at-prod`, …) that any page load sets — without them the proxy answers
 * 401 "Application access token required". So the run opens one category page
 * first, keeps its cookies, then pages the API.
 *
 * Each product has `price.price` (list) and `price.salePrice` (the clearance
 * price the site shows against the struck-through list price); configurable
 * products with a `priceRange` across sizes are dropped. Clearance listings
 * hide sold-out products (`outOfStockBehavior: HideProduct`), so rows are in
 * stock. There is no brand field; the brand leads the product name.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "boscovs";

const SITE = "https://www.boscovs.com";
const API = `${SITE}/api/commerce/catalog/storefront/productsearch/search/`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE = 200;
const CAP = 1500;
const PAUSE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VOL_HEADERS = {
  "x-vol-site": "51049",
  "x-vol-tenant": "30471",
  "x-vol-catalog": "1",
  "x-vol-master-catalog": "1",
  "x-vol-currency": "USD",
  "x-vol-locale": "en-US",
  "x-vol-user-claims": "__mzrpt__",
  "x-vol-app-claims": "__mzrpt__",
};

/** Clearance categories (ids from each page's `data-mz-preload-pagecontext`), with gender and page budget. */
export const BOSCOVS_SLICES: [id: number, gender: ProductRecord["gender"], category: string | null, pages: number][] = [
  [999002886, "kadin", null, 3], // Women's clothing clearance
  [999002887, "kadin", "Shoes", 1], // Women's shoes clearance
  [25000006, "kadin", null, 1], // Handbags & accessories clearance
  [999002888, "erkek", null, 2], // Men's clothing clearance
  [999002893, "erkek", "Shoes", 1], // Men's shoes clearance
  [999002530, null, null, 1], // Beauty clearance
];

export const searchUrl = (categoryId: number, start: number) =>
  `${API}?filter=${encodeURIComponent(`categoryId req ${categoryId}`)}&pageSize=${PAGE}&startIndex=${start}`;

/** Map one Kibo search item. Pure; null unless a single sale price below list. */
export function mapBoscovs(x: any, gender: ProductRecord["gender"], category: string | null): ProductRecord | null {
  const code = x?.productCode;
  const name = String(x?.content?.productName ?? "").trim();
  const slug = x?.content?.seoFriendlyUrl;
  if (!code || !name || !slug || x?.priceRange) return null;
  const list = Number(x?.price?.price);
  const sale = Number(x?.price?.salePrice);
  if (!(sale > 0) || !(list > sale)) return null;
  const photos = (x?.content?.productImages ?? [])
    .map((im: any) => (typeof im?.imageUrl === "string" && im.imageUrl ? `https:${im.imageUrl.replace(/^https?:/, "")}?max=800` : null))
    .filter(Boolean) as string[];
  const kids = /\b(girls?|boys?|toddler|infant|baby|kids?)\b/i.test(name);
  return {
    brand,
    country: "US",
    externalId: String(code),
    name,
    url: `${SITE}/product/${slug}/${code}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true,
    category,
    gender: kids ? "cocuk" : gender,
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

/** Anonymous session cookies from one page load (name=value pairs only). */
async function sessionCookies(): Promise<string> {
  const res = await fetch(`${SITE}/category/all-womens-clearance`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`boscovs: session page HTTP ${res.status}`);
  await res.text();
  const raw: string[] = typeof (res.headers as any).getSetCookie === "function" ? (res.headers as any).getSetCookie() : [];
  const jar = raw.map((c) => c.split(";")[0]).filter((c) => c.includes("="));
  if (!jar.some((c) => c.startsWith("sb-sf-at-prod="))) throw new Error("boscovs: no storefront session cookie");
  return jar.join("; ");
}

export async function listBoscovs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const cookie = await sessionCookies();
  const perSlice: ProductRecord[][] = [];
  for (const [id, gender, category, pages] of BOSCOVS_SLICES) {
    const rows: ProductRecord[] = [];
    for (let p = 0; p < pages; p++) {
      await sleep(PAUSE_MS);
      const res = await fetch(searchUrl(id, p * PAGE), {
        headers: { "User-Agent": UA, Accept: "application/json", cookie, ...VOL_HEADERS },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`boscovs: category ${id} start ${p * PAGE}: HTTP ${res.status}`);
      const d: any = await res.json();
      const items: any[] = Array.isArray(d?.items) ? d.items : [];
      for (const x of items) {
        const r = mapBoscovs(x, gender, category);
        if (r) rows.push(r);
      }
      if (items.length < PAGE || (p + 1) * PAGE >= Number(d?.totalCount ?? 0)) break;
    }
    perSlice.push(rows);
  }
  // Round-robin so the cap trims every section a little.
  const byId = new Map<string, ProductRecord>();
  for (let i = 0; byId.size < CAP && perSlice.some((s) => i < s.length); i++) {
    for (const s of perSlice) {
      const r = s[i];
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      if (byId.size >= CAP) break;
    }
  }
  return [...byId.values()];
}

export const listProducts = listBoscovs;
