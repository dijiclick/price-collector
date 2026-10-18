import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { INSIDER_CLIENT_ID, INSIDER_ENDPOINT, mapInsider, type InsiderShop } from "./_insider";

/**
 * Machka TR (İpekyol Group, a women's label) through its Insider
 * recommendation feed — the same route as Twist (twist-v2.ts), built 2026-10-18.
 *
 * machka.com.tr runs the İpekyol Group Next.js storefront (_ipekyolgroup.ts
 * would read `/_next/data/<build>/indirim.json` fine from the Mac), but the
 * whole host answers 403 to GitHub's runners (probe run 39124308073: home,
 * `_next/data` and a PDP all 403). Insider's feed (partner `ipekyolmachka`)
 * answers the runner with 200.
 *
 * The feed has one row per SIZE, in stock only, and returns at most 100 rows
 * per request with no paging. The sale (`discount.TRY > 0`; `discount` is a
 * PERCENT here, not lira) is partitioned on two axes — price band × discount
 * band — because Machka prices cluster on a few points (9.995 TL alone held
 * 100+ size rows). 20 requests return every discounted model the feed has
 * (178 models / 644 size rows on 2026-10-18; a second strategy added none).
 *
 * The record id is `product_attributes.old_group_id`, which is the storefront
 * product id (20812 ↔ /urun/siyah-nakisli-ipek-elbise, checked 2026-10-18), so
 * a pasted link resolved by lib/live-brands/machka.ts lands on the same row.
 */
export const SHOP: InsiderShop = {
  brand: "machka",
  partnerName: "ipekyolmachka",
  discountFilter: "[discount.TRY][>][0]",
  priceEdges: [1, 5000, 6000, 7000, 8000, 9000, 9994, 9996, 11000, 13000, 1000000],
  strategies: ["new-arrivals"],
  rowKind: "size",
  defaultGender: "kadin",
};
/** Discount-percent band edges, crossed with the price bands. */
export const DISCOUNT_EDGES = [0, 40, 101];

export const brand = SHOP.brand;

const PAUSE_MS = Number(process.env.MACHKA_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function machkaUrl(strategy: string, lo: number, hi: number, dlo: number, dhi: number): string {
  const filter =
    `([discount.TRY][>][${dlo}])*([discount.TRY][<][${dhi}])*([price.TRY][>][${lo}])*([price.TRY][<][${hi}])`;
  const q = new URLSearchParams({
    details: "true", locale: "tr_TR", currency: "TRY", partnerName: SHOP.partnerName,
    clientId: INSIDER_CLIENT_ID, size: "100", filter,
  });
  return `${INSIDER_ENDPOINT}/${strategy}?${q}`;
}

/** Merge one model's size rows into a record. Pure. */
export function mapMachka(rows: any[]): ProductRecord | null {
  const r = mapInsider(SHOP, rows);
  if (!r) return null;
  // The feed's category list leads with the sale bucket ("İndirim"); the
  // product type is `kategori`, else the next entry.
  const pa = rows[0]?.product_attributes ?? {};
  const cats: string[] = Array.isArray(rows[0]?.category) ? rows[0].category.map(String) : [];
  const typed = typeof pa.kategori === "string" && pa.kategori.trim() ? pa.kategori.trim() : null;
  r.category = typed ?? cats.find((c) => !/^(i̇|i|İ)ndirim$|^koleksiyon$/i.test(c.trim())) ?? null;
  return r;
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const rows = new Map<string, any>();
  let requests = 0;
  const P = SHOP.priceEdges;
  for (const strategy of SHOP.strategies) {
    for (let i = 0; i + 1 < P.length; i++) {
      for (let k = 0; k + 1 < DISCOUNT_EDGES.length; k++) {
        if (requests > 0) await sleep(PAUSE_MS);
        requests++;
        const d = await getJson<any>(machkaUrl(strategy, P[i], P[i + 1], DISCOUNT_EDGES[k], DISCOUNT_EDGES[k + 1]), { retries: 1 }).catch(() => null);
        if (!d?.success || !Array.isArray(d.data)) {
          if (requests === 1) throw new Error("machka: Insider feed refused");
          continue;
        }
        for (const x of d.data) if (x?.item_id) rows.set(String(x.item_id), x);
      }
    }
  }
  const groups = new Map<string, any[]>();
  for (const x of rows.values()) {
    const k = String(x.groupcode ?? x.item_id);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(x);
  }
  const out: ProductRecord[] = [];
  for (const g of groups.values()) {
    const r = mapMachka(g);
    if (r && r.listPrice != null) out.push(r);
  }
  return out.slice(0, 1500);
}
