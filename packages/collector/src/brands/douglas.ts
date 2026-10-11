/**
 * Douglas Switzerland (douglas.ch) — the big multi-brand perfumery, SAP Commerce.
 *
 * The site's own OCC search API (`/api/v2/products/search/category/<code>`)
 * answers plain JSON, but `www.douglas.ch` sits behind Akamai and returns a
 * fake "400 Request Too Long" to datacenter IPs. The mobile app is a Capacitor
 * shell on `app.douglas.ch` (from the Android APK's capacitor.config.json), and
 * that host serves the same `/api/v2` without the wall: verified from a GitHub
 * runner 2026-10-11 (probe run 38134704516), no special headers needed.
 *
 * Two quirks, both measured 2026-10-11:
 * - A Varnish in front keys its cache on the `fields` parameter ONLY, so a
 *   second request with the same `fields` but another `currentPage` gets the
 *   first page back (for 20 min). Each page therefore asks for the same field
 *   list in a different ORDER (a permutation chosen by page number), which
 *   OCC treats identically but the cache sees as a new key. Same page number
 *   → same string, so a cached hit is always the right page.
 * - `pageSize` above 48 is a 400.
 *
 * Category 05 is "Sale"; `gender:FEMALE` narrows it to women (~8.5k rows). The
 * category also holds "Point Rouge" offers that show a percentage but no struck
 * price, so a row counts as a deal only when `storeValue` (the struck price)
 * is above `value`. Every row is one variant (a volume or a shade) with its
 * own stock level; `baseProduct` groups them.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const API = "https://app.douglas.ch/api/v2/products/search/category/05";
const SITE = "https://www.douglas.ch";
const QUERY = ":promotion:gender:FEMALE";
const PAGE_SIZE = 48;
const MAX_PAGES = 55;
const CAP = 1500;
const PAUSE_MS = Number(process.env.DOUGLAS_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRODUCT_FIELDS = [
  "code", "name", "url", "stock(DEFAULT)", "price(DEFAULT)", "baseProduct", "baseProductName",
  "images(DEFAULT)", "brand(DEFAULT)", "brandLine(DEFAULT)", "classifications(DEFAULT)",
  "availability(DEFAULT)", "contentUnit", "numberContentUnits",
];

/** The n-th permutation (factorial base) of the product field list. Pure. */
export function fieldsFor(page: number): string {
  const pool = [...PRODUCT_FIELDS];
  const out: string[] = [];
  let n = page;
  for (let k = pool.length; k > 0; k--) {
    out.push(pool.splice(n % k, 1)[0]);
    n = Math.floor(n / k);
  }
  return `products(${out.join(",")}),pagination(DEFAULT)`;
}

export const pageUrl = (page: number): string =>
  `${API}?currentPage=${page}&pageSize=${PAGE_SIZE}&query=${encodeURIComponent(QUERY)}` +
  `&fields=${encodeURIComponent(fieldsFor(page))}`;

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** "Caudalie" + "Vinoperfect" + "Anti-Pigmentflecken Creme" → one display name. Pure. */
export function douglasName(p: any): string {
  const parts: string[] = [];
  for (const s of [p?.brand?.name, p?.brandLine?.name, p?.baseProductName || p?.classifications?.[0]?.name]) {
    const v = clean(s);
    if (v && !parts.some((x) => x.toLowerCase().includes(v.toLowerCase()))) parts.push(v);
  }
  return parts.join(" ");
}

/** "50 ml", "510 Gramm", "1 Stück" are amounts; anything else is a shade. */
const AMOUNT = /^\d[\d.,]*\s*(ml|l|cl|g|gramm|kg|mg|stück|st\.?|pieces?|paar|oz)\b/i;

/** One search row → record, or null when it is not a real struck-price deal. Pure. */
export function mapDouglas(p: any, country: CountryCode = "CH"): ProductRecord | null {
  const price = Number(p?.price?.value);
  const was = Number(p?.price?.storeValue);
  const name = douglasName(p);
  if (!p?.code || !name || !p?.url || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(was) || was <= price) return null;
  const level = p?.stock?.stockLevelStatus;
  const inStock = (level === "inStock" || level === "lowStock") && p?.availability?.code !== "NOT_AVAILABLE";
  const variant = clean(p.name);
  const isAmount = AMOUNT.test(variant);
  const images = cleanGallery((p.images ?? []).map((i: any) => i?.url));
  return {
    brand: "douglas",
    country,
    externalId: String(p.code),
    name,
    url: `${SITE}${p.url}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: p.price.currencyIso ?? COUNTRIES[country].currency,
    inStock,
    category: clean(p.classifications?.[0]?.name) || null,
    gender: "kadin",
    variants: variant
      ? {
          colors: isAmount ? [] : [variant],
          sizes: isAmount
            ? [{ label: variant, availability: !inStock ? "out_of_stock" : level === "lowStock" ? "low_on_stock" : "in_stock" }]
            : [],
        }
      : null,
    groupKey: p.baseProduct ? `douglas-${p.baseProduct}` : null,
    colorName: variant || null,
  };
}

/** Register as `listDouglas(country)`. CH only. */
export async function listDouglas(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CH") return [];
  const byId = new Map<string, ProductRecord>();
  let pages = MAX_PAGES;
  let inStock = 0;
  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(pageUrl(page), { country, headers: { "Accept-Language": "de-CH,de;q=0.9" } });
    const total = Number(d?.pagination?.totalPages);
    if (Number.isFinite(total)) pages = Math.min(total, MAX_PAGES);
    const rows: any[] = d?.products ?? [];
    if (!rows.length) break;
    for (const p of rows) {
      const r = mapDouglas(p, country);
      if (r && !byId.has(r.externalId)) {
        byId.set(r.externalId, r);
        if (r.inStock) inStock++;
      }
    }
    if (inStock >= CAP) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
