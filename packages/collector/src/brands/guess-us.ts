/**
 * GUESS — United States (2026-10-18).
 *
 * guess.com/en-us is the same Salesforce + Algolia storefront family as
 * guess.eu, but on its own North-America site (`Sites-guess_na-Site`) with its
 * OWN Algolia application: `P3GWXCPFXL`, index `production__products__en_US`
 * (8,440 products; the EU app YML5RK21LG has no US index, which is why US was
 * left out on 2026-09-23). The app id and its search-only key are printed in
 * every US page (`algoliaData`). Algolia has no bot wall; the site itself
 * geo-redirects non-US visitors to guess.eu, and answers a GitHub runner
 * directly (probe 39134320076).
 *
 * Hit shape is the EU one, so guess.ts's `mapHit` does the mapping; only the
 * storefront host (guess.com, not guess.eu) and the Cloudinary folder (`NA`,
 * not `EU`) differ. Only discounted rows are collected — `isSale:true`
 * (~4,600 on 2026-10-18) and `master_price_retail > master_price` — in-stock
 * first, capped.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { mapHit, type Market } from "./guess";
import type { CountryCode } from "../../../../lib/countries";

const APP_ID = "P3GWXCPFXL";
const API_KEY = "e88593fcd7b28159782cd8ece0c3860d";
export const US_MARKET: Market = { country: "US", index: "production__products__en_US", path: "en-us", currency: "USD" };
const SITE = "https://www.guess.com";
const PER_PAGE = 1000;
const CAP = 1500;
const MAX_REQ = 8;

export function usImageUrl(objectID: string): string {
  return `https://img.guess.com/image/upload/f_auto,q_auto,fl_strip_profile,w_640,ar_2:3,c_fill/v1/NA/Style/ECOMM/${objectID}`;
}

/** A US hit → a record, or null unless it is a real markdown. */
export function mapUsHit(h: any): ProductRecord | null {
  const r = mapHit(h, US_MARKET);
  if (!r || r.listPrice == null || r.listPrice <= r.price) return null;
  return {
    ...r,
    url: h.url ? `${SITE}${h.url}` : `${SITE}/en-us/`,
    imageUrl: usImageUrl(r.externalId),
  };
}

export const saleParams = (filters: string[][], page = 0, hits = PER_PAGE, extra = "") =>
  `query=&hitsPerPage=${hits}&page=${page}&${extra}facetFilters=${encodeURIComponent(JSON.stringify([["isSale:true"], ...filters]))}`;

/**
 * The index answers at most 1,000 hits per query (`paginationLimitedTo`), so a
 * single sale query stops at 1,000 of ~4,600. The sale set is split by the
 * index's own section facet (`guess_gender`), one query per section; "Home"
 * (candles, homeware) is skipped.
 */
export async function listGuessUs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const search = (params: string) =>
    getJson<any>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${US_MARKET.index}/query`, {
      country,
      method: "POST",
      headers: { "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    });
  const head = await search(saleParams([], 0, 0, `facets=${encodeURIComponent(JSON.stringify(["guess_gender"]))}&`));
  const sections = Object.keys(head?.facets?.guess_gender ?? {}).filter((v) => v !== "Home");
  const byId = new Map<string, ProductRecord>();
  for (const section of sections.slice(0, MAX_REQ)) {
    const d = await search(saleParams([[`guess_gender:${section}`]]));
    for (const h of d?.hits ?? []) {
      const r = mapUsHit(h);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  // Women and Men each exceed the cap on their own; interleave so neither
  // section crowds the other out of the 1,500 kept.
  const all = [...byId.values()];
  const inStock = all.filter((r) => r.inStock);
  const groups = new Map<string, ProductRecord[]>();
  for (const r of inStock) groups.set(String(r.gender), [...(groups.get(String(r.gender)) ?? []), r]);
  const mixed: ProductRecord[] = [];
  for (let i = 0; mixed.length < inStock.length; i++) for (const g of groups.values()) if (g[i]) mixed.push(g[i]);
  return [...mixed, ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
