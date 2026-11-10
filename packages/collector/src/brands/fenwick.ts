/**
 * Fenwick (fenwick.co.uk) — the British department store, GBP. Added 2026-11-10.
 *
 * A plain Shopify storefront: `/collections/<handle>/products.json` answers a
 * GitHub runner (probe run 42800582417; `/meta.json` currency GBP). The shop
 * holds ~25,000 products including furniture, food and toys, so only its own
 * fashion and beauty SALE collections are walked — never the whole catalogue.
 * `vendor` is the maker (Barbour, Marella, Swarovski, Clarins ...).
 *
 * Beauty gift sets carry a "worth £X" compare-at (the sum of the parts), which
 * is not a markdown; those are dropped.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { mapShopify, marketHeaders } from "./_shopify";

const SITE = "https://fenwick.co.uk";
/** Sale collection, the gender its rows default to, and its share of the cap. */
export const FENWICK_COLLECTIONS: [handle: string, gender: ProductRecord["gender"], cap: number][] = [
  ["sale-women", "kadin", 1300],
  ["sale-beauty", null, 400],
  ["sale-men", "erkek", 500],
];
const STORE = { brand: "fenwick", sites: { GB: SITE } };
const MAX_PAGES = Number(process.env.FENWICK_MAX_PAGES ?? 8);
const PAUSE_MS = Number(process.env.SHOPIFY_PAUSE_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SET = /\b(gift ?sets?|sets?|duo|trio|kit|collection|advent|worth)\b/i;

/** One products.json row of a sale collection → record, or null. Pure. */
export function mapFenwick(p: any, gender: ProductRecord["gender"], country: CountryCode = "GB"): ProductRecord | null {
  const m = mapShopify(STORE, country, SITE, p);
  if (!m || m.listPrice == null) return null;
  const maker = typeof p?.vendor === "string" && p.vendor.trim() ? p.vendor.trim() : null;
  // Beauty: a set's compare-at is its "worth", not a price it was sold at.
  if (gender === null && SET.test(`${m.name} ${m.category ?? ""}`)) return null;
  return {
    ...m,
    name: maker && !m.name.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${m.name}` : m.name,
    maker,
    gender: gender ?? m.gender,
  };
}

export async function listFenwick(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const out: ProductRecord[] = [];
  const ids = new Set<string>();
  let calls = 0;
  for (const [handle, gender, cap] of FENWICK_COLLECTIONS) {
    const rows: ProductRecord[] = [];
    for (let n = 1; n <= MAX_PAGES; n++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(`${SITE}/collections/${handle}/products.json?limit=250&page=${n}`, { country, headers: marketHeaders(country) });
      const ps: any[] = data?.products ?? [];
      if (!ps.length) break;
      for (const p of ps) {
        const r = mapFenwick(p, gender, country);
        if (!r || ids.has(r.externalId)) continue;
        ids.add(r.externalId);
        rows.push(r);
      }
      if (rows.filter((r) => r.inStock).length >= cap) break;
    }
    out.push(...[...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)].slice(0, cap));
  }
  if (!out.length) throw new Error("fenwick: no reduced rows in the sale collections");
  return out;
}
