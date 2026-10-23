/**
 * Boscov's (boscovs.com, US only) — family-owned department store, clearance only.
 *
 * Since 2026-10-22 the shop is a Next.js App Router front end on Kibo (tenant
 * 30471): the old `/api/commerce/catalog/storefront/productsearch/search`
 * proxy is gone (404) and no `sb-sf-at-prod` session cookie is set any more.
 * Each category page's server render carries its 30 products as JSON in the
 * React flight payload (`self.__next_f.push`): `{"items":[{"code",…}],
 * "currentPage","totalPages"}`, paged with `?page=N` (0-based; N=1 is page 2).
 * ~175 KB gzip a page, no cookie, no key.
 *
 * Each product has `price.salePrice` and `price.listPrice` (the struck "Ticketed"
 * price the site shows); products with a `priceRange` across sizes are
 * dropped. Clearance listings hide sold-out products, and `isAvailable` is
 * carried through.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { toMinor } from "../normalize";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "boscovs";

const SITE = "https://www.boscovs.com";
const CAP = 1500;
const PAUSE_MS = Number(process.env.BOSCOVS_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Clearance categories (slug, gender, category, page budget at 30 a page). */
export const BOSCOVS_SLICES: [slug: string, gender: ProductRecord["gender"], category: string | null, pages: number][] = [
  ["all-womens-clothing-clearance", "kadin", null, 18],
  ["all-womens-shoes-clearance", "kadin", "Shoes", 6],
  ["handbags-accessories-clearance", "kadin", null, 6],
  ["mens-clothing-clearance", "erkek", null, 12],
  ["all-mens-shoes-clearance", "erkek", "Shoes", 3],
  ["all-beauty-clearance", null, null, 2],
];

export const categoryUrl = (slug: string, page: number) => `${SITE}/category/${slug}${page > 0 ? `?page=${page}` : ""}`;

/** The decoded React flight payload of an App Router page. */
function flight(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* a chunk that is not a plain string — skip */
    }
  }
  return out;
}

/** The product grid of a category page: items, page index and page count; null when absent. Pure. */
export function parseCategoryPage(html: string): { items: any[]; currentPage: number; totalPages: number } | null {
  const s = flight(html);
  const at = s.indexOf('"items":[{"code"');
  if (at < 0) return null;
  const from = at + '"items":'.length;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if ((ch === "]" || ch === "}") && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let items: any[];
  try {
    items = JSON.parse(s.slice(from, end + 1));
  } catch {
    return null;
  }
  const pg = s.slice(end).match(/^\],"currentPage":(\d+),"totalPages":(\d+)/);
  return { items, currentPage: pg ? Number(pg[1]) : 0, totalPages: pg ? Number(pg[2]) : 1 };
}

/** Map one category-grid item. Pure; null unless a single sale price below list. */
export function mapBoscovs(x: any, gender: ProductRecord["gender"], category: string | null): ProductRecord | null {
  const code = x?.code;
  const name = String(x?.name ?? "").trim();
  const path = typeof x?.productUrl === "string" && x.productUrl.startsWith("/product/") ? x.productUrl : null;
  if (!code || !name || !path) return null;
  if (x?.priceRange && x.priceRange !== "$undefined") return null;
  const list = Number(x?.price?.listPrice);
  const sale = Number(x?.price?.salePrice);
  if (!(sale > 0) || !(list > sale)) return null;
  const photos = [x?.primaryImage?.imageUrl, x?.hoverImageUrl]
    .filter((u): u is string => typeof u === "string" && /^(https?:)?\/\//.test(u))
    .map((u) => `https:${u.replace(/^https?:/, "")}?max=800`);
  const kids = /\b(girls?|boys?|toddler|infant|baby|kids?)\b/i.test(name);
  return {
    brand,
    country: "US",
    externalId: String(code),
    name,
    url: `${SITE}${path}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: x?.isAvailable !== false,
    category,
    gender: kids ? "cocuk" : gender,
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

export async function listBoscovs(country: CountryCode, fetchHtml: (u: string) => Promise<string> = (u) => getText(u, { country, timeoutMs: 45_000 })): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const perSlice: ProductRecord[][] = [];
  let calls = 0;
  for (const [slug, gender, category, pages] of BOSCOVS_SLICES) {
    const rows: ProductRecord[] = [];
    for (let p = 0; p < pages; p++) {
      if (calls++) await sleep(PAUSE_MS);
      const grid = parseCategoryPage(await fetchHtml(categoryUrl(slug, p)));
      if (!grid) {
        if (p === 0 && slug === BOSCOVS_SLICES[0][0]) throw new Error(`boscovs: no product grid on ${categoryUrl(slug, p)} (markup changed?)`);
        break;
      }
      for (const x of grid.items) {
        const r = mapBoscovs(x, gender, category);
        if (r) rows.push(r);
      }
      if (!grid.items.length || p + 1 >= grid.totalPages) break;
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
