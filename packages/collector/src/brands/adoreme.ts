/**
 * Adore Me (adoreme.com) — US lingerie, sleep and swim. The Next.js front is
 * Cloudflare-walled for some networks, but its catalogue comes from the
 * site's own JSON API, `/v8/catalog/categories/<id>`, which the listing page
 * calls with `segments=nonvip_recent,webapp` (the anonymous, non-member
 * shopper). Category 895 is "Sale" (~2,650 products, 2026-10-21).
 *
 * `pricing` is in cents: `regular` is the list price, `markdown_price` the
 * store's clearance price ("Clearance | 80% OFF"). `catalog_promos` (multi-
 * buy / bundle prices) and VIP-member prices are not markdowns and are
 * ignored. One product is one colour; the listing has no per-size stock.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.adoreme.com";
const SALE_CATEGORY = 895;
const PER_PAGE = 100; // the API serves at most 100 a page (asking for more returns its default 50)
const MAX_PAGES = 30;
const CAP = 1500;
const PAUSE_MS = Number(process.env.ADOREME_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const photo = (g: any): string | null => {
  const u = typeof g?.url === "string" ? g.url : typeof g?.value === "string" ? g.value : null;
  if (!u || g?.source !== "image") return null;
  return u.replace("{{width}}", "1360").replace(/^\/\//, "https://");
};

/** One `/v8/catalog` product → a record, or null without a clearance price. Pure. */
export function mapAdoreMe(p: any, country: CountryCode = "US"): ProductRecord | null {
  const pr = p?.pricing ?? {};
  const price = Number(pr.markdown_price);
  const was = Number(pr.regular);
  if (!p?.id || !p?.name || !p?.permalink || !Number.isInteger(price) || price <= 0 || !Number.isInteger(was) || was <= price) return null;
  const images = cleanGallery((p.gallery ?? []).map(photo));
  const colour = typeof p.color === "string" ? p.color.trim() : "";
  return {
    brand: "adoreme",
    country,
    externalId: String(p.id),
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: `${ORIGIN}/${p.canonical_url || p.permalink}`,
    imageUrl: images?.[0] ?? null,
    images,
    price,
    listPrice: was,
    currency: "USD",
    inStock: p.in_stock !== false,
    category: typeof p.category === "string" ? p.category : null,
    gender: "kadin",
    variants: null,
    groupKey: p.sister_and_fit_group_id ? `adoreme:${p.sister_and_fit_group_id}` : null,
    colorName: colour || null,
  };
}

/** Register as `listAdoreMe(country)`. US only. */
export async function listAdoreMe(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let page = 1; (page - 1) * PER_PAGE < total && byId.size < CAP; page++) {
    if (page > MAX_PAGES) throw new Error(`adoreme/${country}: ${total} sale products exceed ${MAX_PAGES} pages`);
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(
      `${ORIGIN}/v8/catalog/categories/${SALE_CATEGORY}?page=${page}&per_page=${PER_PAGE}&segments=nonvip_recent,webapp`,
      { country },
    );
    const products: any[] = data?.products;
    if (!Array.isArray(products)) throw new Error(`adoreme/${country}: page ${page} returned no product list`);
    total = Number(data.total) || 0;
    for (const p of products) {
      const r = mapAdoreMe(p, country);
      if (r) byId.set(r.externalId, r);
    }
    if (products.length < PER_PAGE) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
