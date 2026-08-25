import { canResolveLive } from "../../../lib/live-lookup";
import type { BrandAdapter, SizeVariant } from "./types";
import { diff, diffSizes } from "./differ";
import {
  connect,
  migrate,
  upsertProducts,
  latestSnapshots,
  insertSnapshots,
  insertEvents,
  pruneSnapshots,
  dbNow,
  countInStock,
  markMissingOutOfStock,
  getWatchedSizes,
  getVariantsByIds,
  key,
  type Db,
} from "./db";

export interface BrandResult {
  brand: string;
  count: number;
  events: number;
  /** Products no longer listed, marked out of stock this run. */
  gone?: number;
  /** Wall-clock split, so a slow run can be attributed without guesswork. */
  fetchMs?: number;
  writeMs?: number;
  error?: string;
  /**
   * Collected nothing while the brand still had stock from a previous run.
   * Adapters swallow fetch failures and return [], so a WAF/IP block looks
   * exactly like "nothing on sale" — this separates the two so a silently
   * dead brand fails the run instead of logging a green tick.
   */
  blocked?: boolean;
}

/**
 * Run every adapter, persist snapshots, and record diffed events. Per-brand isolated.
 * Uses bulk DB operations (a handful of queries per brand) so it stays fast against a
 * networked Postgres instead of doing per-product round-trips.
 */
/**
 * Per-brand ceiling. 5 minutes, raised from 4 on 2026-08-25.
 *
 * Beymen is the largest catalogue at ~42.000 products and was measured across
 * nine successful runs at 150–185s, with a failure the same day — i.e. it was
 * grazing a 240s limit and losing a whole sweep whenever it crossed. A brand
 * that times out is not fatal (the others still land, and it retries in 90
 * minutes), but it is the biggest catalogue going stale for no good reason.
 *
 * Costs nothing in practice: brands run six at a time, the whole sweep takes
 * ~6 minutes, and even the pathological case of every brand hanging is three
 * waves of 5 minutes against the workflow's 40-minute budget.
 */
const BRAND_TIMEOUT_MS = Number(process.env.BRAND_TIMEOUT_MS ?? 300000);

function withTimeout<T>(p: Promise<T>, ms: number, brand: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

/**
 * How many brands fetch at once. Collecting them one after another made the run
 * the *sum* of every brand's fetch time (~14 min, against a 25 min job cap);
 * concurrently it is the slowest single brand instead. Brands each hit a
 * different host, so this adds no per-host load.
 */
const BRAND_CONCURRENCY = Number(process.env.BRAND_CONCURRENCY ?? 9);

/**
 * How many brands may be writing at once.
 *
 * This was hard-serialised (effectively 1) because a single brand's upsert was
 * enormous — Beymen rewrote ~45k rows every run. Change-detection cut the total
 * write time from 1413s to ~306s, so the thing the serialisation protected
 * against no longer exists, and one writer now leaves 4 of the pool's 5
 * connections idle while every other brand queues behind it.
 *
 * Kept below the pool size so the reads each brand does outside the gate
 * (dbNow, countInStock) still have connections to use.
 */
const WRITE_CONCURRENCY = Number(process.env.WRITE_CONCURRENCY ?? 3);

/**
 * Counting semaphore. A released slot is handed straight to the next waiter
 * rather than decremented and re-acquired — otherwise a caller arriving in the
 * gap between the decrement and the waiter waking would push past `width`.
 */
export function createGate(width: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function gate<T>(fn: () => Promise<T>): Promise<T> {
    if (active < width) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export async function runCollect(adapters: BrandAdapter[], db: Db): Promise<BrandResult[]> {
  // Indexed rather than pushed, so the report keeps registry order regardless of
  // which brand happens to finish first.
  const results: BrandResult[] = new Array(adapters.length);

  /**
   * Fetching parallelises freely; writing is bounded so a burst of brands cannot
   * exhaust the connection pool. Brands write disjoint rows — each one's
   * products, snapshots, events and delist sweep are scoped to its own brand —
   * so concurrent writers do not contend for the same tuples.
   */
  const withWriteLock = createGate(WRITE_CONCURRENCY);

  // Which (product, size) pairs someone watches — bounds per-size back_in_stock
  // events to what's actually wanted. Read once; the set barely changes mid-run.
  const watchedSizes = await getWatchedSizes(db);

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(BRAND_CONCURRENCY, adapters.length) }, async () => {
      while (cursor < adapters.length) {
        const i = cursor++;
        results[i] = await collectBrand(adapters[i], db, withWriteLock, watchedSizes);
      }
    }),
  );
  return results;
}

async function collectBrand(
  adapter: BrandAdapter,
  db: Db,
  withWriteLock: <T>(fn: () => Promise<T>) => Promise<T>,
  watchedSizes: Map<number, Set<string>>,
): Promise<BrandResult> {
  const res: BrandResult = { brand: adapter.brand, count: 0, events: 0 };
  try {
    const runStart = await dbNow(db);
    const prevInStock = await countInStock(db, adapter.brand);
    const fetchStart = Date.now();
    const products = await withTimeout(adapter.listProducts(), BRAND_TIMEOUT_MS, adapter.brand);
    res.fetchMs = Date.now() - fetchStart;
    if (products.length === 0) {
      // Genuinely empty is possible (a brand with nothing listed), but a brand
      // that had stock last run and returns nothing now is a broken adapter or
      // an IP block — don't let that pass as success.
      if (prevInStock > 0) {
        res.blocked = true;
        res.error = `collected 0 products but ${prevInStock} were in stock last run — adapter broken or IP-blocked`;
      }
      return res;
    }

    const writeStart = Date.now();
    await withWriteLock(async () => {
      // Capture per-size availability BEFORE the upsert overwrites products.variants,
      // so diffSizes has a real "previous" to compare against. Only for watched ids.
      const prevVariants = watchedSizes.size
        ? await getVariantsByIds(db, [...watchedSizes.keys()])
        : new Map<number, SizeVariant[]>();

      const idByKey = await upsertProducts(db, products);
      const ids = products.map((p) => idByKey.get(key(p.brand, p.externalId))!).filter(Boolean);
      const prevByProduct = await latestSnapshots(db, ids);

      const snapRows: { productId: number; price: number; listPrice: number | null; inStock: boolean }[] = [];
      const eventRows: { productId: number; e: ReturnType<typeof diff>[number] }[] = [];
      for (const rec of products) {
        const id = idByKey.get(key(rec.brand, rec.externalId));
        if (!id) continue;
        const prev = prevByProduct.get(id) ?? null;
        const curr = { price: rec.price, listPrice: rec.listPrice, inStock: rec.inStock };
        for (const e of diff(prev, curr)) eventRows.push({ productId: id, e });

        // Per-size back_in_stock: only for sizes someone watches on this product.
        const sizesWatched = watchedSizes.get(id);
        if (sizesWatched?.size) {
          for (const label of diffSizes(prevVariants.get(id) ?? null, rec.variants?.sizes ?? [])) {
            if (sizesWatched.has(label)) {
              eventRows.push({
                productId: id,
                e: { type: "back_in_stock", oldPrice: null, newPrice: rec.price, pct: null, size: label },
              });
            }
          }
        }
        // Snapshot only on first sight or an actual change. Storing an identical
        // row for every product every run is what bloats the table — prices
        // rarely move between runs — and the latest stored snapshot still equals
        // the current state, so diffing and price history stay correct.
        if (
          !prev ||
          prev.price !== curr.price ||
          prev.listPrice !== curr.listPrice ||
          prev.inStock !== curr.inStock
        ) {
          snapRows.push({ productId: id, ...curr });
        }
        res.count++;
      }
      await insertSnapshots(db, snapRows);
      await insertEvents(db, eventRows);
      res.events = eventRows.length;

      // Anything we didn't see this run is gone from the brand's listing — sold
      // out or delisted. Only sweep when the run looks complete, so a partial
      // collection (timeout, blocked category) can't wipe the whole brand.
      if (prevInStock === 0 || products.length >= prevInStock * 0.5) {
        // Tracked products of a resolvable brand are the reprice pass's to
        // own — the sweep never sees them, so "missing" is not evidence.
        res.gone = await markMissingOutOfStock(db, adapter.brand, runStart, canResolveLive(adapter.brand));
      }
    });
    // Includes time queued behind another brand's write — that queueing is
    // exactly what we want visible, since the lock is serial by design.
    res.writeMs = Date.now() - writeStart;
  } catch (err) {
    res.error = err instanceof Error ? err.message : String(err);
  }
  return res;
}

/** CLI entry: connect, migrate, collect all registered brands, notify watchers, log. */
export async function main(adapters: BrandAdapter[]): Promise<void> {
  const db = await connect();
  await migrate(db);
  const results = await runCollect(adapters, db);
  // Defensive cap on history length (change-only inserts already keep it small).
  try {
    const pruned = await pruneSnapshots(db);
    if (pruned) console.log(`pruned ${pruned} old snapshot rows`);
  } catch (err) {
    console.error("prune failed:", err instanceof Error ? err.message : err);
  }
  for (const r of results) {
    if (r.error) console.error(`✗ ${r.brand}: ${r.error}`);
    else
      console.log(
        `✓ ${r.brand}: ${r.count} products, ${r.events} events` +
          (r.gone ? `, ${r.gone} delisted` : "") +
          // Attribution for the run budget: minutes are billed by wall clock, so
          // knowing whether a slow brand is slow to fetch or slow to write is the
          // difference between tuning concurrency and tuning SQL.
          (r.fetchMs != null ? ` [fetch ${(r.fetchMs / 1000).toFixed(1)}s` : "") +
          (r.writeMs != null ? ` write ${(r.writeMs / 1000).toFixed(1)}s]` : r.fetchMs != null ? "]" : ""),
      );
  }
  // After the sweeps and before anyone is notified: a drop found here has to
  // reach the same run's notifier, or it waits 90 minutes for no reason.
  try {
    const { repriceTracked } = await import("./reprice");
    const r = await repriceTracked(db);
    if (r.considered > 0) {
      console.log(
        `↻ reprice: ${r.repriced}/${r.considered} re-checked, ${r.changed} moved, ` +
          `${r.events} events` + (r.failed ? `, ${r.failed} unreachable` : ""),
      );
    }
  } catch (err) {
    console.error("reprice failed:", err instanceof Error ? err.message : err);
  }

  try {
    const { notify } = await import("./notifier");
    await notify(db);
  } catch (err) {
    console.error("notifier failed:", err instanceof Error ? err.message : err);
  }
  try {
    const { pushNotify } = await import("./push");
    await pushNotify(db);
  } catch (err) {
    console.error("push notifier failed:", err instanceof Error ? err.message : err);
  }
  await db.close();

  // Fail the run so CI actually tells us a brand died. Only for brands that
  // went from "had stock" to "collected nothing" — a thrown error is usually a
  // transient hiccup that self-heals next run, so it logs but doesn't fail.
  const blocked = results.filter((r) => r.blocked);
  if (blocked.length > 0) {
    console.error(
      `\n${blocked.length} brand(s) collected nothing despite having stock: ` +
        blocked.map((b) => b.brand).join(", ") +
        `\nLikely an IP block (route that brand through a proxy) or a broken adapter.`,
    );
    process.exitCode = 1;
  }
}
