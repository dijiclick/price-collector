/**
 * Sprinter (sprintersports.com) — Spain's big sportswear/sneaker chain (JD
 * Group), EUR, through the Algolia index its Next.js storefront searches.
 *
 * Every www.sprintersports.com page answers a plain request with an Akamai
 * "Access Denied" (Mac and GitHub runners alike), but Algolia's DSN host and
 * the image CDN (`resize.sprintercdn.com`) don't: verified from a runner
 * 2026-10-21 (probe run 39613511783). App id, search-only key and index name
 * (`JD_Sprinter_ES`) are public, shipped in the site's JS bundle. The same app
 * also holds `JD_Sprinter_PT` (the Portuguese store, `/pt/` URLs, same fields
 * and filters — 1,500 rows from the Mac 2026-10-21), so PT is collected too.
 *
 * Filter, all measured 2026-10-21:
 * - `origin:web` is Sprinter's own stock; `mkp` is the marketplace (vidaXL,
 *   bikes, school bags…) with sellers' own "was" prices — left out.
 * - `discount:true` is the sale flag; a row still counts only when `price` is
 *   below `original_price`.
 * - `listed:true` is what the site shows: the unlisted discounted rows are the
 *   sold-out ones (996 of 1000 sampled had no online stock).
 * - Gender `M` (mujer), `H` (hombre), `U` (unisex) — kids (`NO`/`NA`) are
 *   outside the scope. Together ≈2.8k rows (M 770, H 1465, U 590). Algolia
 *   returns at most 1000 hits per query, so each gender is one query, split
 *   into price bands when it holds more (H: 2 bands) — ~5 requests a run.
 * Sports equipment (rackets, weights, bikes, watches…) is dropped client-side
 * by `area_desc` / taxonomy, since neither is a filterable attribute.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = process.env.SPRINTER_ALGOLIA_APP ?? "E4HUV6LTU3";
const KEY = process.env.SPRINTER_ALGOLIA_KEY ?? "00a5751e6bffeea3eb3b3cd1072499e5";
/** One index per store; the Portuguese one carries `/pt/` product URLs. */
export const SPRINTER_INDEX: Partial<Record<CountryCode, string>> = { ES: "JD_Sprinter_ES", PT: "JD_Sprinter_PT" };
const IMG = "https://resize.sprintercdn.com/f/800x800/";
const HITS = 1000;
const MAX_REQUESTS = 24;
const CAP = 1500;
const PAUSE_MS = 400;
export const SPRINTER_FILTER = "discount:true AND origin:web AND active:true AND listed:true";
/** Mujer, hombre, unisex (kids' `NO`/`NA` are out of scope). */
const GENDERS = ["M", "H", "U"];
/** Only what the mapper reads — a full hit is ~7.7 kB (category trees). */
const ATTRS = [
  "objectID", "code", "name", "title", "url", "price", "original_price", "image", "brand", "brand_data",
  "gender", "area_desc", "google_taxonomy_cat", "subhead", "dimensions", "dimensions_with_stock",
  "has_stock_online", "variants",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Clothing, shoes and accessories; equipment (`Material técnico`) is out. */
const AREAS = new Set(["Calzado", "Textil", "Complementos"]);
/** Accessories that are not fashion. */
const NOT_FASHION = /^(relojes|auriculares|material|paleteros|toallas|botellas|cantimploras|pelotas|balones)/i;

export function genderOf(g: unknown): ProductRecord["gender"] {
  switch (g) {
    case "M": return "kadin";
    case "H": return "erkek";
    case "NO": case "NA": return "cocuk";
    default: return null;
  }
}

/** "Reebok Nano X5 Edge - Blanco - Zapatillas Mujer | Sprinter" → "Blanco". Pure. */
export function colourOf(title: unknown): string | null {
  const parts = clean(title).replace(/\s*\|.*$/, "").split(" - ");
  return parts.length === 3 && parts[1] ? parts[1] : null;
}

/** "SKECHERS" → "Skechers" when the hit has no `brand_data.name`. */
function makerOf(h: any): string | null {
  const n = clean(h?.brand_data?.name);
  if (n) return n;
  const b = clean(h?.brand);
  return b ? b.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase()) : null;
}

/** Map one Algolia hit, or null when it is not an in-scope struck-price deal. Pure. */
export function mapSprinter(h: any, country: CountryCode = "ES"): ProductRecord | null {
  const price = Number(h?.price);
  const was = Number(h?.original_price);
  const code = clean(h?.code) || clean(h?.objectID);
  const name = clean(h?.name);
  const path = clean(h?.url);
  if (!code || !name || !path || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(was) || was <= price) return null;
  if (!AREAS.has(h?.area_desc)) return null;
  const type = clean(h?.google_taxonomy_cat);
  if (h.area_desc === "Complementos" && (!type || NOT_FASHION.test(type))) return null;

  const file = typeof h?.image?.file === "string" ? h.image.file : null;
  const images = cleanGallery([file ? IMG + file : null]);

  // `dimensions_with_stock` counts shop stock too; a row with no ONLINE stock
  // can't be bought here, so none of its sizes are.
  const online = h.has_stock_online !== false;
  const inStockSet = new Set(online && Array.isArray(h.dimensions_with_stock) ? h.dimensions_with_stock.map(String) : []);
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const d of Array.isArray(h.dimensions) ? h.dimensions : []) {
    const label = clean(String(d ?? ""));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: inStockSet.has(label) ? "in_stock" : "out_of_stock" });
  }
  const inStock = online && (sizes.length === 0 || sizes.some((s) => s.availability === "in_stock"));
  const colour = colourOf(h.title);
  const variants: number[] = Array.isArray(h.variants) ? h.variants.filter((v: unknown) => typeof v === "number" && v > 0) : [];

  return {
    brand: "sprinter",
    country,
    externalId: code,
    name,
    url: /^https?:\/\//.test(path) ? path : `https://${path.replace(/^\/+/, "")}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock,
    category: type || clean(h.subhead) || null,
    maker: makerOf(h),
    gender: genderOf(h.gender),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    // The hit's own list of sibling colour rows (objectIDs) is the grouping.
    groupKey: variants.length > 1 ? `sprinter:${Math.min(...variants)}` : null,
    colorName: colour,
  };
}

/** One slice's filter: a gender and a price band [lo, hi). Pure. */
export function sliceFilter(gender: string, lo: number, hi: number): string {
  let f = `${SPRINTER_FILTER} AND gender:${gender}`;
  if (lo > 0) f += ` AND price >= ${lo}`;
  if (Number.isFinite(hi)) f += ` AND price < ${hi}`;
  return f;
}

async function query(country: CountryCode, filters: string): Promise<any> {
  const params = new URLSearchParams({
    query: "", hitsPerPage: String(HITS), page: "0", filters,
    attributesToRetrieve: JSON.stringify(ATTRS), attributesToHighlight: "[]", attributesToSnippet: "[]",
  });
  return getJson<any>(`https://${APP}-dsn.algolia.net/1/indexes/${SPRINTER_INDEX[country]}/query`, {
    method: "POST",
    country,
    headers: {
      "X-Algolia-Application-Id": APP,
      "X-Algolia-API-Key": KEY,
      "Content-Type": "application/json",
      Referer: "https://www.sprintersports.com/",
    },
    body: JSON.stringify({ params: params.toString() }),
  });
}

/** Register as `listSprinter(country)`. ES and PT. */
export async function listSprinter(country: CountryCode): Promise<ProductRecord[]> {
  if (!SPRINTER_INDEX[country]) return [];
  const byId = new Map<string, ProductRecord>();
  // Algolia stops at 1000 hits per query (paginationLimitedTo), so a gender
  // whose sale outgrows that is split into price bands until each fits.
  const todo: [string, number, number][] = GENDERS.map((g) => [g, 0, Infinity]);
  let requests = 0;
  while (todo.length && requests < MAX_REQUESTS) {
    const [g, lo, hi] = todo.shift()!;
    if (requests++ > 0) await sleep(PAUSE_MS);
    const d = await query(country, sliceFilter(g, lo, hi));
    const hits: any[] = d?.hits ?? [];
    if (Number(d?.nbHits ?? 0) > hits.length && hi - lo > 2) {
      const mid = Number.isFinite(hi) ? Math.round((lo + hi) / 2) : lo > 0 ? lo * 2 : 40;
      todo.push([g, lo, mid], [g, mid, hi]);
      continue;
    }
    for (const h of hits) {
      const r = mapSprinter(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  // Women, men and unisex take turns so the cap does not cut one section off.
  const all = [...byId.values()];
  const buckets = new Map<string, ProductRecord[]>();
  for (const r of all) {
    const k = `${r.inStock ? 0 : 1}:${r.gender ?? "u"}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
  }
  const out: ProductRecord[] = [];
  for (const stock of [0, 1]) {
    const lists = [...buckets.entries()].filter(([k]) => k.startsWith(`${stock}:`)).map(([, v]) => v);
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out.slice(0, CAP);
}
