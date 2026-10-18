import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { INSIDER_CLIENT_ID, INSIDER_ENDPOINT, mapInsider, type InsiderShop } from "./_insider";

/**
 * LOFT TR through its Insider recommendation feed (partner `loft`, see
 * _insider.ts). Built 2026-10-18.
 *
 * loft.com.tr is a nopCommerce shop that only renders HTML listings (41 pages
 * for the women's outlet alone), so the feed is the data source; it answers a
 * GitHub runner with 200 (probe run 39124308073).
 *
 * THE FEED'S LIMITS shape the walk: at most 100 rows per request, no paging,
 * and one row per product group per request. LOFT prices sit on a handful of
 * points (299,99 / 599,99 / 999,99 / 1.299,99 …) with 100+ discounted models
 * each, so a price band alone cannot get under the cap. The walk starts from a
 * seed grid of price bands per gender (Kadın first — the audience — then Erkek)
 * and splits any band that comes back full: by price while it is wider than a
 * few lira, then by discount percent (`discount.TRY` is a percent here). Within
 * the request budget it reaches every discounted women's model (1,331 on
 * 2026-10-18) and most men's (~1,700 total).
 *
 * The id is `groupcode`, which is the number at the end of the PDP url
 * (`/p/crop-kadin-atlet-380` ↔ 380). Rows are single sizes and the feed only
 * returns one per group, so sizes are NOT collected (variants null) — one size
 * would misreport the rest as missing.
 */
export const SHOP: InsiderShop = {
  brand: "loft",
  partnerName: "loft",
  discountFilter: "[discount.TRY][>][0]",
  priceEdges: [1, 295, 390, 440, 490, 595, 605, 635, 685, 780, 830, 880, 895, 905, 995, 1005, 1170, 1220, 1270, 1295, 1305, 1365, 1415, 1465, 1560, 1660, 1760, 1950, 2150, 2340, 2730, 3125, 100000],
  strategies: ["highest-discounted"],
  rowKind: "size",
  defaultGender: null,
};
export const GENDERS = ["Kadın", "Erkek"];

export const brand = SHOP.brand;

const MAX_REQUESTS = Number(process.env.LOFT_MAX_REQUESTS ?? 90);
const CAP = Number(process.env.LOFT_MAX_PRODUCTS ?? 1500);
const PAUSE_MS = Number(process.env.LOFT_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Band { gender: string; lo: number; hi: number; dlo: number; dhi: number }

export function loftUrl(b: Band, strategy = SHOP.strategies[0]): string {
  const filter =
    `(${SHOP.discountFilter})*([discount.TRY][>][${b.dlo}])*([discount.TRY][<][${b.dhi}])` +
    `*([price.TRY][>][${b.lo}])*([price.TRY][<][${b.hi}])*([gender][=][${b.gender}])`;
  const q = new URLSearchParams({
    details: "true", locale: "tr_TR", currency: "TRY", partnerName: SHOP.partnerName,
    clientId: INSIDER_CLIENT_ID, size: "100", filter,
  });
  return `${INSIDER_ENDPOINT}/${strategy}?${q}`;
}

/** Halve a full band: by price while wider than 4 TL, then by discount. Null when it cannot be split. */
export function splitBand(b: Band): [Band, Band] | null {
  if (b.hi - b.lo > 4) {
    const mid = Math.round((b.lo + b.hi) / 2) - 0.05;
    return [{ ...b, hi: mid }, { ...b, lo: mid - 0.01 }];
  }
  if (b.dhi - b.dlo > 4) {
    const mid = Math.round((b.dlo + b.dhi) / 2);
    return [{ ...b, dhi: mid + 0.01 }, { ...b, dlo: mid }];
  }
  return null;
}

/** Map one feed row (a single size of one model). Pure. */
export function mapLoft(row: any): ProductRecord | null {
  const r = mapInsider(SHOP, [row]);
  if (!r) return null;
  r.variants = null;
  r.name = r.name.replace(/\s+/g, " ");
  if (!r.category && typeof row?.product_type === "string" && row.product_type.trim()) r.category = row.product_type.trim();
  return r;
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const gender of GENDERS) {
    const queue: Band[] = [];
    for (let i = 0; i + 1 < SHOP.priceEdges.length; i++) {
      queue.push({ gender, lo: SHOP.priceEdges[i], hi: SHOP.priceEdges[i + 1], dlo: 0, dhi: 101 });
    }
    while (queue.length && requests < MAX_REQUESTS && byId.size < CAP) {
      const b = queue.shift()!;
      if (requests > 0) await sleep(PAUSE_MS);
      requests++;
      const d = await getJson<any>(loftUrl(b), { retries: 1 }).catch(() => null);
      if (!d?.success || !Array.isArray(d.data)) {
        if (requests === 1) throw new Error("loft: Insider feed refused");
        continue;
      }
      const halves = d.data.length >= 100 ? splitBand(b) : null;
      // A full band is re-asked in halves; keep its rows too, in case the budget ends first.
      if (halves) queue.unshift(...halves);
      for (const x of d.data) {
        const r = mapLoft(x);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
  }
  if (process.env.LOFT_DEBUG) console.error(`loft: ${requests} requests, ${byId.size} deals`);
  return [...byId.values()].slice(0, CAP);
}
