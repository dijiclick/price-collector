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
 * not `EU`) differ. Only discounted rows are kept
 * (`master_price_retail > master_price`), in-stock first, capped.
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
/** Request budget per run (playbook: <= ~60). */
const MAX_REQ = 60;
/** Upper bound of the first price slice; nothing in the index is near it. */
const MAX_PRICE = 100000;
/** Nearly everything is under $1,024; starting there saves ~7 halvings per section. */
const SPLIT_AT = 1024;

export function usImageUrl(objectID: string): string {
  return `https://img.guess.com/image/upload/f_auto,q_auto,fl_strip_profile,w_640,ar_2:3,c_fill/v1/NA/Style/ECOMM/${objectID}`;
}

/** A US (or CA) hit → a record, or null unless it is a real markdown. */
export function mapUsHit(h: any, m: Market = US_MARKET): ProductRecord | null {
  const r = mapHit(h, m);
  if (!r || r.listPrice == null || r.listPrice <= r.price) return null;
  return {
    ...r,
    url: h.url ? `${SITE}${h.url}` : `${SITE}/${m.path}/`,
    imageUrl: usImageUrl(r.externalId),
  };
}

/** Only what `mapHit` reads — whole hits are ~10x larger. */
const ATTRS = [
  "objectID", "baseProductID", "name", "url", "currencyCode", "in_stock", "variants",
  "master_price", "master_price_retail", "guess_gender", "guess_colorDisplayName", "color",
];

/** One price slice of one section: `lo <= master_price < hi`. */
export const rangeParams = (section: string, lo: number, hi: number, hits = PER_PAGE) =>
  `query=&hitsPerPage=${hits}&attributesToRetrieve=${encodeURIComponent(JSON.stringify(ATTRS))}` +
  `&facetFilters=${encodeURIComponent(JSON.stringify([[`guess_gender:${section}`]]))}` +
  `&numericFilters=${encodeURIComponent(JSON.stringify([`master_price>=${lo}`, `master_price<${hi}`]))}`;

/**
 * Collected from the WHOLE index, not `isSale:true`. By 2026-10-20 the flag
 * had come off most markdowns: 525 hits carried it, while the very puffer in
 * guess-us.test.ts (isSale:true on 10-18) sat at isSale:false still $140.94
 * vs $238 — the price its guess.com page shows. The markdown itself
 * (`master_price_retail > master_price`, checked by `mapUsHit`) is the signal.
 *
 * The index answers at most 1,000 hits per query (`paginationLimitedTo`) and
 * Women alone holds ~5,200, so each section ("Home" skipped) is bisected on
 * `master_price` until every slice fits under the cap — 41 requests on 2026-10-20.
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
  const head = await search(`query=&hitsPerPage=0&facets=${encodeURIComponent(JSON.stringify(["guess_gender"]))}`);
  const sections = Object.keys(head?.facets?.guess_gender ?? {}).filter((v) => v !== "Home");
  const byId = new Map<string, ProductRecord>();
  let requests = 1;
  const slice = async (section: string, lo: number, hi: number): Promise<void> => {
    requests++;
    const d = await search(rangeParams(section, lo, hi));
    // Over the cap and still splittable: halve the price range instead.
    if ((d?.nbHits ?? 0) > PER_PAGE && hi - lo > 1 && requests < MAX_REQ) {
      const mid = Math.round((lo + hi) / 2);
      await slice(section, lo, mid);
      await slice(section, mid, hi);
      return;
    }
    for (const h of d?.hits ?? []) {
      const r = mapUsHit(h);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  };
  for (const section of sections) {
    await slice(section, 0, SPLIT_AT);
    await slice(section, SPLIT_AT, MAX_PRICE);
  }
  // Women and Men each exceed the cap on their own; interleave so neither
  // section crowds the other out of the 1,500 kept.
  const all = [...byId.values()];
  console.log(`guess/US: ${all.length} markdowns in ${requests} requests`);
  const inStock = all.filter((r) => r.inStock);
  const groups = new Map<string, ProductRecord[]>();
  for (const r of inStock) groups.set(String(r.gender), [...(groups.get(String(r.gender)) ?? []), r]);
  const mixed: ProductRecord[] = [];
  for (let i = 0; mixed.length < inStock.length; i++) for (const g of groups.values()) if (g[i]) mixed.push(g[i]);
  return [...mixed, ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

/**
 * GUESS — Canada (2026-10-21). Same Algolia app, index `production__products__en_CA`
 * (~4,250 products, every hit `currencyCode: "CAD"`). Canada does NOT set
 * `isSale` (12 hits) — its markdowns live in the site's own Sale / Promotion /
 * Last Chance / Mid-Season Sale categories (`categories.id`, e.g.
 * `Guess-Women-Sale#…`), whose rows carry `master_price` < `master_price_retail`:
 * the price guess.com/en-ca itself shows (PDP strikes the retail, JSON-LD offer
 * = master_price). The category ids are read from the facet at run time (only
 * the top level of each sale tree, which already holds its sub-shelves), one
 * query per category; each must stay under Algolia's 1,000-hit window or we throw.
 */
export const CA_MARKET: Market = { country: "CA", index: "production__products__en_CA", path: "en-ca", currency: "CAD" };
const CA_SALE_ROOT = /^[A-Za-z]+(?:-(?:Women|Men|Kids))?-(?:Sale|Promotion|LastChance|MidSeasonSale)#/;

/** The top-level sale/promotion category ids from a `categories.id` facet. Pure. */
export function caSaleCategories(facet: Record<string, number> | undefined): string[] {
  return Object.keys(facet ?? {}).filter((k) => CA_SALE_ROOT.test(k));
}

export async function listGuessCa(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const search = (params: string) =>
    getJson<any>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${CA_MARKET.index}/query`, {
      country,
      method: "POST",
      headers: { "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    });
  const head = await search(`query=&hitsPerPage=0&maxValuesPerFacet=1000&facets=${encodeURIComponent(JSON.stringify(["categories.id"]))}`);
  const cats = caSaleCategories(head?.facets?.["categories.id"]);
  if (!cats.length) throw new Error("guess/CA: no sale categories in the index");
  if (cats.length > 20) throw new Error(`guess/CA: ${cats.length} sale categories, over the request budget`);
  const byId = new Map<string, ProductRecord>();
  for (const cat of cats) {
    const d = await search(`query=&hitsPerPage=${PER_PAGE}&page=0&facetFilters=${encodeURIComponent(JSON.stringify([[`categories.id:${cat}`]]))}`);
    if (Number(d?.nbHits ?? 0) > PER_PAGE) throw new Error(`guess/CA: ${cat} has ${d.nbHits} hits, over the ${PER_PAGE} window`);
    for (const h of d?.hits ?? []) {
      if (h?.guess_gender === "Home") continue;
      const r = mapUsHit(h, CA_MARKET);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
