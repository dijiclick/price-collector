import type { ProductRecord, SizeVariant } from "../types";
import { getJson, getText } from "../http";
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
 * returns one per group (whatever the strategy or filter), so the feed alone
 * cannot give sizes.
 *
 * SIZES (2026-10-20) come from the outlet LISTING pages instead. Every tile
 * carries `data-variants='[{"id":<groupcode>,"sizes":[{"id":…,"name":"XS"}],…}]'`
 * for its colours, listing the sizes IN STOCK (12315: the PDP has XS, S sold
 * out, M; the tile lists XS and M). The pages are server-rendered and slow
 * (~0.1 s a product on the shop's side) but answer a GitHub runner (probe run
 * 39468749527, 200, 1.1 MB per 100 products), so the two outlets (~2,000 women,
 * plus men) are read 100 a page, three at a time, within a time budget, women
 * first. Sizes are stored with `sizesInStockOnly`, so the upsert keeps a size
 * that sells out as out_of_stock (sizes.ts). Before this LOFT stored no sizes
 * and fell out of every size-filtered feed.
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

const SITE = "https://www.loft.com.tr";
/** Women's outlet first: the audience. */
export const OUTLETS = ["/c/kadin-outlet-671", "/c/erkek-outlet-672"];
const LIST_PAGE = 100;
const LIST_CONCURRENCY = 3;
const LIST_MAX_PAGES = Number(process.env.LOFT_LIST_MAX_PAGES ?? 60);
const SIZES_BUDGET_MS = Number(process.env.LOFT_SIZES_BUDGET_MS ?? 170_000);

export const outletUrl = (path: string, page: number) => `${SITE}${path}?pagesize=${LIST_PAGE}&pagenumber=${page}`;

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** groupcode → sizes in stock, from every tile's `data-variants` on one listing page. Pure. */
export function tileSizes(html: string): Map<string, SizeVariant[]> {
  const out = new Map<string, SizeVariant[]>();
  for (const m of html.matchAll(/data-variants='([^']*)'/g)) {
    let list: any[];
    try {
      list = JSON.parse(unescape(m[1]));
    } catch {
      continue;
    }
    for (const v of Array.isArray(list) ? list : []) {
      if (v?.id == null || !Array.isArray(v.sizes) || out.has(String(v.id))) continue;
      const seen = new Set<string>();
      const sizes: SizeVariant[] = [];
      for (const z of v.sizes) {
        const label = String(z?.name ?? "").trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        sizes.push({ label, availability: "in_stock" });
      }
      if (sizes.length) out.set(String(v.id), sizes);
    }
  }
  return out;
}

/** The last page the pager links to (1 when there is no pager). Pure. */
export function lastPage(html: string): number {
  let n = 1;
  for (const m of html.matchAll(/pagenumber=(\d+)/g)) n = Math.max(n, Number(m[1]));
  return n;
}

/** Sizes for every outlet tile reachable within the budget. A failed page is skipped (its products keep stored sizes). */
export async function outletSizes(deadline: number): Promise<Map<string, SizeVariant[]>> {
  const sizes = new Map<string, SizeVariant[]>();
  const add = (html: string) => {
    for (const [k, v] of tileSizes(html)) if (!sizes.has(k)) sizes.set(k, v);
  };
  for (const path of OUTLETS) {
    if (Date.now() > deadline) break;
    const first = await getText(outletUrl(path, 1), { timeoutMs: 60_000 }).catch(() => null);
    if (!first) continue;
    add(first);
    const pages = Array.from({ length: Math.min(lastPage(first), LIST_MAX_PAGES) - 1 }, (_, i) => i + 2);
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(LIST_CONCURRENCY, pages.length) }, async () => {
        while (i < pages.length && Date.now() < deadline) {
          const html = await getText(outletUrl(path, pages[i++]), { timeoutMs: 60_000 }).catch(() => null);
          if (html) add(html);
        }
      }),
    );
  }
  return sizes;
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
  const started = Date.now();
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
  const records = [...byId.values()].slice(0, CAP);
  const sizes = await outletSizes(started + SIZES_BUDGET_MS).catch(() => new Map<string, SizeVariant[]>());
  let sized = 0;
  for (const r of records) {
    const z = sizes.get(r.externalId);
    if (!z) continue;
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes: z };
    r.sizesInStockOnly = true;
    sized++;
  }
  if (process.env.LOFT_DEBUG) console.error(`loft: ${requests} requests, ${byId.size} deals, ${sizes.size} tiles with sizes, ${sized} deals sized`);
  return records;
}
