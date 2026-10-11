/**
 * Sephora US + Canada — sephora.com's own catalog API (the JSON its web app
 * reads for every category grid), no key, no cookie. Turkey is a different
 * platform (SFCC OCAPI, sephora.ts) and is untouched.
 *
 * The site's sale page is the category tree with the `on_sale` refinement
 * applied, so the sweep is each top-level category with
 * `ref=filters[on_sale]=true`, deduplicated by product (minis, gifts and men's
 * overlap the main trees). `countryCode=CA` + `loc=en-CA` returns the Canadian
 * assortment priced in CAD from the same host. Measured 2026-10-11: US ~330
 * sale products, CA ~900; `pageSize` is capped at 200 server-side.
 *
 * Each card carries ONE sku (`currentSku`) with its `listPrice` and
 * `salePrice` strings. When either is a range ("$15.98 - $31.95") the card
 * spans several sizes/shades and there is no single was-price to quote — the
 * same artifact as the TR −%81 bug — so such cards are dropped rather than
 * guessed. Cosmetics carry no sizes here; shades would need a per-product call.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const SEPHORA_INTL_MARKETS: Partial<Record<CountryCode, { loc: string; site: string }>> = {
  US: { loc: "en-US", site: "https://www.sephora.com" },
  CA: { loc: "en-CA", site: "https://www.sephora.com/ca/en" },
};

/** Top-level trees that hold sale products (Tools & Brushes had none, 2026-10-11). */
const CATEGORIES = [
  "cat140006", // Makeup
  "cat150006", // Skincare
  "cat130038", // Hair
  "cat160006", // Fragrance
  "cat140014", // Bath & Body
  "cat60270", // Gifts
  "cat130044", // Men
  "cat1830032", // Mini Size
  "cat130042", // Tools & Brushes
];
const PAGE = 200;
const MAX_PAGES_PER_CATEGORY = 6;
const PAUSE_MS = Number(process.env.SEPHORA_INTL_PAUSE_MS ?? 700);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "$1,234.50" → 1234.5; a range or anything unparsable → null. */
export function parseMoney(s: unknown): number | null {
  if (typeof s !== "string" || /-|–/.test(s)) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function categoryUrl(cat: string, country: CountryCode, page: number): string {
  const m = SEPHORA_INTL_MARKETS[country]!;
  const q = new URLSearchParams({
    currentPage: String(page),
    pageSize: String(PAGE),
    loc: m.loc,
    ch: "rwd",
    countryCode: country,
    ref: "filters[on_sale]=true",
  });
  return `https://www.sephora.com/api/v2/catalog/categories/${cat}/products?${q}`;
}

/** One category-grid product → a record, or null when it is not a single-price markdown. */
export function mapSephoraCard(p: any, country: CountryCode, category: string | null = null): ProductRecord | null {
  const m = SEPHORA_INTL_MARKETS[country];
  const sku = p?.currentSku;
  if (!m || !p?.productId || !sku) return null;
  const list = parseMoney(sku.listPrice);
  const sale = parseMoney(sku.salePrice);
  if (list == null || sale == null || !(sale < list)) return null;
  // Grid images come at imwidth=270; the same URL serves any width.
  const big = (u: unknown) => (typeof u === "string" ? u.replace(/imwidth=\d+/, "imwidth=1000") : null);
  const img = big(p.heroImage);
  const alt = big(p.altImage);
  const path = typeof p.targetUrl === "string" ? p.targetUrl : `/product/${p.productId}`;
  return {
    brand: "sephora",
    country,
    externalId: String(p.productId),
    name: [p.brandName, p.displayName ?? p.productName].filter(Boolean).join(" ").trim(),
    url: `${m.site}${path.startsWith("/") ? "" : "/"}${path}`,
    imageUrl: img,
    images: cleanGallery([img, alt], img),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    // The grid only lists purchasable cards; sold-out skus are not shown on sale.
    inStock: true,
    // Same convention as the TR adapter: the brand rides in `category`.
    category: typeof p.brandName === "string" ? p.brandName : category,
    gender: null,
    variants: null,
    colorName: null,
  };
}

export async function listSephoraIntl(country: CountryCode): Promise<ProductRecord[]> {
  if (!SEPHORA_INTL_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let failures = 0;
  for (const cat of CATEGORIES) {
    for (let page = 1; page <= MAX_PAGES_PER_CATEGORY && byId.size < CAP; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(categoryUrl(cat, country, page), { country }).catch(() => null);
      if (!data) {
        failures++;
        break;
      }
      const products: any[] = data.products ?? [];
      for (const p of products) {
        const r = mapSephoraCard(p, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const total = Number(data.totalProducts ?? 0);
      if (products.length < PAGE || page * PAGE >= total) break;
    }
  }
  if (byId.size === 0 && failures > 0) throw new Error(`sephora/${country}: catalog API refused (${failures} failed calls)`);
  return [...byId.values()].slice(0, CAP);
}

export const brand = "sephora";
export const listProducts = listSephoraIntl;
