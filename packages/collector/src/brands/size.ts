/**
 * size? (size.co.uk) — JD Group's sneaker and streetwear store, GBP. Added
 * 2026-11-10.
 *
 * The site is a Shopify storefront whose `/products.json` and product pages
 * answer a script with a "Verifying your connection" challenge, but its search
 * runs on Bloomreach Discovery (`account_id` 8351, `domain_key` size, both in
 * the home page) — the public `core.dxpapi.com` API, no key (probe run
 * 42798407673). Docs carry `price` (was), `sale_price` (now), the maker in
 * `brand`, and `sizes`: the sizes still on sale.
 *
 * `sort=discount desc` puts every reduced row first (2,002 of 3,619 on
 * 2026-11-10 — the store's clearance is large and mostly menswear), so the walk
 * stops at the first page with no reduction. Women's footwear is read first so
 * the cap cannot crowd it out. The index has no gender field: rows of the
 * women's pass are women's, the rest are left unset.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.size.co.uk";
const API = "https://core.dxpapi.com/api/v1/core/";
const ROWS = 200;
const PAUSE_MS = Number(process.env.SIZE_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pass: a `Product Type` filter (or none), the gender its rows get, the category, its cap and page budget. */
export const SIZE_PASSES: { fq: string | null; gender: ProductRecord["gender"]; category: string | null; cap: number; pages: number }[] = [
  { fq: 'Product Type:"Womens Footwear"', gender: "kadin", category: "Trainers", cap: 500, pages: 3 },
  { fq: null, gender: null, category: null, cap: 700, pages: 5 },
];

export function sizeSearchUrl(fq: string | null, start: number): string {
  const q = new URLSearchParams({
    account_id: "8351", domain_key: "size", request_type: "search", search_type: "keyword",
    q: "*", rows: String(ROWS), start: String(start), sort: "discount desc",
    fl: "pid,title,brand,url,price,sale_price,sizes,thumb_image,large_image",
    url: SITE, ref_url: SITE, _br_uid_2: "uid=modadrop",
  });
  if (fq) q.set("fq", fq);
  return `${API}?${q}`;
}

/** One Bloomreach doc → record. Pure. */
export function mapSize(d: any, gender: ProductRecord["gender"], category: string | null, country: CountryCode = "GB"): ProductRecord | null {
  const price = Number(d?.sale_price);
  const was = Number(d?.price);
  const path = String(d?.url ?? "");
  if (!d?.pid || !d?.title || !path || !Number.isFinite(price) || price <= 0) return null;
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const raw of Array.isArray(d.sizes) ? d.sizes : []) {
    const label = String(raw ?? "").trim().toUpperCase();
    if (!label || /^ONE SIZE$/.test(label) || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: "in_stock" });
  }
  const imgs: string[] = [...(Array.isArray(d.large_image) ? d.large_image : []), d.thumb_image].filter(
    (u: unknown): u is string => typeof u === "string" && u.startsWith("http"),
  );
  const maker = typeof d.brand === "string" && d.brand.trim() ? d.brand.trim() : null;
  return {
    brand: "size",
    country,
    externalId: String(d.pid),
    name: String(d.title).replace(/\s+/g, " ").trim(),
    url: path.startsWith("http") ? path : `${SITE}${path}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: true, // the search index lists sellable products only
    category,
    maker,
    gender,
    variants: sizes.length ? { colors: [], sizes } : null,
    sizesInStockOnly: sizes.length > 0,
  };
}

export async function listSize(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const pass of SIZE_PASSES) {
    let taken = 0;
    pages: for (let p = 0; p < pass.pages; p++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(sizeSearchUrl(pass.fq, p * ROWS), { country });
      const docs: any[] = data?.response?.docs ?? [];
      let reduced = 0;
      for (const d of docs) {
        const r = mapSize(d, pass.gender, pass.category, country);
        if (!r || r.listPrice == null) continue;
        reduced++;
        if (byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        if (++taken >= pass.cap) break pages;
      }
      if (reduced === 0 || docs.length < ROWS) break;
    }
  }
  if (!byId.size) throw new Error("size: Bloomreach returned no reduced rows");
  return [...byId.values()];
}
