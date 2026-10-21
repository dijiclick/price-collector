import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Rossmann Germany (rossmann.de), through the Rossmann app's own search API.
 *
 * The website sits behind an F5 "Client Challenge" (JavaScript proof-of-work)
 * that a plain request never passes. The Android app (`de.rossmann.app.android`)
 * talks to `api-ocm-de-prod.rossmann.net/search.ws/v1` — no key, no cookie,
 * only `X-API-Version: 1.0` — and that host answers a GitHub runner 200
 * (probe run 39613147946, 2026-10-21).
 *
 * `search/products/by-category` returns up to 200 rows a page with the shelf
 * price (`retailPrice`), the struck price (`strikethroughPrice`), stock
 * (`stockLevelStatus`), the EAN, image and product URL. Only the two beauty
 * trees are read — Make-up (OLCAT1_1, ~7.2k) and Pflege & Duft
 * (OLCAT1_2325036, ~9.2k) — never food, household, baby or health (owner
 * rule): ~84 pages, ~35 s sequential, run 4 at a time.
 *
 * Which strikes are real: the price API (`product-api/v1/product/{ean}/price`)
 * for a struck row answers `isStreichpreisUvp: false, streichpreis 11.99,
 * verkaufspreis 9.60` — the strike is Rossmann's own former shelf price and
 * the sale price is what everyone pays for one unit (no card, no multi-buy).
 * Those rows carry a "NN% Sparen" disruptor. ~1% of struck rows carry no such
 * badge (online-only items struck by a cent or against the maker's RRP) — they
 * are dropped, so only promotions Rossmann itself advertises remain.
 *
 * Men's items come from the `Geschlecht: "für ihn"` facet (one extra pass,
 * ~4 pages); everything else is left `gender: null` (cosmetics are mostly
 * unisex, and null shows in the women's feed).
 */
const API = "https://api-ocm-de-prod.rossmann.net/search.ws/v1/search/products/by-category";
const SITE = "https://www.rossmann.de";
const HEADERS = { "X-API-Version": "1.0", "User-Agent": "okhttp/4.12.0" };
/** Make-up, Pflege & Duft. */
export const ROSSMANN_DE_CATEGORIES = ["OLCAT1_1", "OLCAT1_2325036"];
const PAGE_SIZE = 200;
/** ~84 today; a runaway guard, not a target. */
const MAX_PAGES = 120;
const CONCURRENCY = 4;
const CAP = 1500;
const MEN_FILTER = 'Geschlecht:"für ihn"';

export function pageUrl(categoryId: string, pageIndex: number, filter?: string): string {
  const q = new URLSearchParams({
    categoryId,
    refUrl: "https://rossmann.app/",
    url: "https://rossmann.app/c",
    pageSize: String(PAGE_SIZE),
    pageIndex: String(pageIndex),
  });
  if (filter) q.set("filter", filter);
  return `${API}?${q}`;
}

const amount = (m: any): number => {
  const n = Number(m?.amount);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** "20% Sparen" — Rossmann's own promotion badge on a struck price. */
const isPromo = (p: any): boolean =>
  (Array.isArray(p?.disruptors) ? p.disruptors : []).some((d: any) => /\d+\s*%\s*Sparen/i.test(String(d?.text ?? "")));

/**
 * Map one search row. Pure. Returns null unless it is a real, advertised
 * markdown (strike above the shelf price AND a "% Sparen" badge).
 */
export function mapRossmannDe(p: any, men: Set<string> = new Set()): ProductRecord | null {
  const ean = String(p?.ean ?? "").trim();
  const url = typeof p?.productUrl === "string" && p.productUrl.startsWith(`${SITE}/`) ? p.productUrl : null;
  const price = amount(p?.price?.retailPrice);
  const was = amount(p?.price?.strikethroughPrice);
  if (!ean || !url || !(price > 0) || !(was > price) || !isPromo(p)) return null;
  if (p?.hasPriceHidden === true) return null;
  const brandName = String(p.brandName ?? "").trim();
  const title = String(p.name ?? "").trim();
  if (!title) return null;
  const name = brandName && !title.toLowerCase().startsWith(brandName.toLowerCase()) ? `${brandName} ${title}` : title;
  // Shades of one product: the app lists them under `variants[type=COLOR]`.
  const shades = (Array.isArray(p.variants) ? p.variants : []).filter((v: any) => v?.type === "COLOR").flatMap((v: any) => v?.elements ?? []);
  const groupEans = [ean, ...shades.map((e: any) => String(e?.ean ?? ""))].filter(Boolean).sort();
  const shade = shades.find((e: any) => e?.isCurrentProduct)?.text;
  return {
    brand: "rossmann",
    country: "DE",
    externalId: ean,
    name,
    url,
    imageUrl: typeof p.image?.url === "string" && p.image.url ? p.image.url : null,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: p.stockLevelStatus === "IN_STOCK" || p.stockLevelStatus === "LOW_STOCK",
    // Leading-zero codes ("0000030167223") are Rossmann-internal, not printed EANs.
    barcodes: /^\d{8,14}$/.test(ean) && !ean.startsWith("0000") ? [ean] : null,
    category: null,
    gender: men.has(ean) ? "erkek" : null,
    variants: null,
    groupKey: shades.length > 1 ? `rossmann-de:${groupEans[0]}` : null,
    colorName: typeof shade === "string" && shade.trim() ? shade.trim() : null,
  };
}

async function pool<T, R>(items: T[], width: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Every row of one category (optionally filtered): page 0 for the total, then the rest in parallel. */
async function crawlCategory(categoryId: string, fetchPage: (u: string) => Promise<any>, filter?: string): Promise<any[]> {
  const first = await fetchPage(pageUrl(categoryId, 0, filter));
  const total = Number(first?.pagination?.totalItems ?? 0);
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
  const rest = await pool(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 1),
    CONCURRENCY,
    (i) => fetchPage(pageUrl(categoryId, i, filter)),
  );
  return [first, ...rest].flatMap((j) => (Array.isArray(j?.products) ? j.products : []));
}

export async function listRossmannDe(fetchPage: (u: string) => Promise<any> = (u) => getJson(u, { country: "DE", headers: HEADERS, retries: 2 })): Promise<ProductRecord[]> {
  const t0 = Date.now();
  const men = new Set<string>();
  const rows: any[] = [];
  for (const cat of ROSSMANN_DE_CATEGORIES) {
    rows.push(...(await crawlCategory(cat, fetchPage)));
    // Gender is best-effort: a failed men's pass leaves the rows untagged.
    try {
      for (const p of await crawlCategory(cat, fetchPage, MEN_FILTER)) if (p?.ean) men.add(String(p.ean));
    } catch (e) {
      console.warn(`rossmann/DE: men's facet failed for ${cat} (${(e as Error)?.message ?? e})`);
    }
  }
  const byId = new Map<string, ProductRecord>();
  for (const p of rows) {
    const r = mapRossmannDe(p, men);
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  // ~2,000 promotions a week against a 1,500 cap: keep in-stock first, then
  // the deepest cuts, so the cap trims shallow -10% rows rather than a whole tree.
  const depth = (r: ProductRecord) => 1 - r.price / (r.listPrice ?? r.price);
  const out = [...byId.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock) || depth(b) - depth(a)).slice(0, CAP);
  console.log(`rossmann/DE: ${rows.length} rows, ${byId.size} discounted, kept ${out.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return out;
}
