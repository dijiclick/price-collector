/**
 * Size-collection helpers shared by adapters (2026-10-20).
 *
 * Since 2026-10-20 a clothes or shoe product with NO size data no longer passes
 * the app's size filter (lib/db.ts `sizeClause`), so a brand that never stores
 * sizes disappears from every size-filtered feed. Two things kept sizes missing:
 *
 * 1. ROTATING DETAIL PASSES WASTED THEIR BUDGET. adidas, FashFed, Calvin Klein
 *    and every Akinon shop without embedded sizes read per-size stock for a
 *    random subset each run (the upsert keeps earlier captures). Random means
 *    most of each run re-reads products already sized, so the backlog drains
 *    slowly (adidas: 20 a run against ~2,000 deals). `sizedIds` tells an
 *    adapter which of its products already have sizes stored, and `sizesFirst`
 *    spends most of the budget on the ones that do not. Adapters stay pure over
 *    HTTP: the collector registers the loader, and without one (tests, scripts)
 *    the set is empty and the queue is exactly what the adapter passed in.
 *
 * 2. SOME FEEDS ONLY LIST THE SIZES IN STOCK (PersonaClick's
 *    `fashion_original_sizes`, Penti's size facet, LOFT's listing tiles). That
 *    is enough for the filter, but a size that sells out simply vanishes, so a
 *    "tell me when my size is back" alert has nothing to watch. A record marked
 *    `sizesInStockOnly` is merged with the stored list instead: every stored
 *    size missing from this run is kept as out_of_stock (db.ts upsertProducts).
 */
import type { CountryCode } from "../../../lib/countries";
import type { SizeVariant } from "./types";

type SizedLoader = (brand: string, country: CountryCode) => Promise<Set<string>>;

let loader: SizedLoader | null = null;
const cache = new Map<string, Promise<Set<string>>>();

/** Set by the collector for one run; `null` clears it. */
export function setSizedLoader(fn: SizedLoader | null): void {
  loader = fn;
  cache.clear();
}

/** External ids of this brand × market whose stored variants already hold sizes. Empty without a loader. */
export function sizedIds(brand: string, country: CountryCode = "TR"): Promise<Set<string>> {
  if (!loader) return Promise.resolve(new Set());
  const k = `${brand}|${country}`;
  let p = cache.get(k);
  if (!p) {
    p = loader(brand, country).catch(() => new Set<string>());
    cache.set(k, p);
  }
  return p;
}

/**
 * At most `limit` items for a detail pass: those with no stored sizes first, in
 * the order given, with `refreshShare` of the budget kept for re-reading sized
 * ones (stock moves, and an unsized product that never yields sizes — a bag —
 * must not starve the refresh). Pure.
 */
export function sizesFirst<T>(items: T[], idOf: (t: T) => string, sized: Set<string>, limit: number, refreshShare = 0.25): T[] {
  if (sized.size === 0) return items.slice(0, limit);
  const fresh = items.filter((t) => !sized.has(idOf(t)));
  const known = items.filter((t) => sized.has(idOf(t)));
  const reserve = Math.min(known.length, Math.floor(limit * refreshShare));
  const take = fresh.slice(0, Math.max(0, limit - reserve));
  return [...take, ...known.slice(0, limit - take.length)];
}

/**
 * This run's in-stock sizes laid over the stored list: a stored size missing
 * now is kept as out_of_stock, in its stored position relative to the others.
 * Pure.
 */
export function mergeInStockSizes(prev: SizeVariant[] | null | undefined, curr: SizeVariant[]): SizeVariant[] {
  if (!prev?.length) return curr;
  const out = [...curr];
  const have = new Set(curr.map((s) => s.label));
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    if (!p?.label || have.has(p.label)) continue;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) {
      const at = out.findIndex((s) => s.label === prev[j].label);
      if (at >= 0) {
        pos = at + 1;
        break;
      }
    }
    out.splice(pos, 0, { label: p.label, availability: "out_of_stock", ...(p.sku != null ? { sku: p.sku } : {}) });
    have.add(p.label);
  }
  return out;
}

const CLOTHING = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL"];

/** A sort key: shoe/number sizes by value ("42,5", "36 2/3"), letter sizes XXS…5XL after them, anything else last. */
export function sizeRank(label: string): number {
  const m = label.trim().match(/^(\d+(?:[.,]\d+)?)(?:\s*(1\/2|½|1\/3|2\/3))?$/);
  if (m) {
    const frac = m[2] === "1/2" || m[2] === "½" ? 0.5 : m[2] === "1/3" ? 0.33 : m[2] === "2/3" ? 0.67 : 0;
    return Number(m[1].replace(",", ".")) + frac;
  }
  const i = CLOTHING.indexOf(label.trim().toUpperCase());
  return i >= 0 ? 1000 + i : 2000;
}

/** Sizes in size order; labels the ranking does not know keep their relative order. Pure. */
export function sortSizes<T extends { label: string }>(xs: T[]): T[] {
  return xs.map((x, i) => ({ x, i })).sort((a, b) => sizeRank(a.x.label) - sizeRank(b.x.label) || a.i - b.i).map((e) => e.x);
}
