import { liveBrands, lookupLive } from "../../../lib/live-lookup";
import { diff } from "./differ";
import {
  applyReprice,
  dbNow,
  insertEvents,
  insertSnapshots,
  latestSnapshots,
  listRepriceCandidates,
  type Db,
} from "./db";

/**
 * Re-check tracked products the brand sweeps cannot see.
 *
 * The sweeps walk sale listings. That is the right shape for finding deals, and
 * the wrong shape for watching one product: a full-price item — everything an
 * on-demand lookup adds — appears in no listing, so it was written once and
 * then never looked at again. It sat at its opening price forever and the drop
 * alert it existed for could not fire, which hollowed out the feature that
 * added it.
 *
 * This pass closes that loop by fetching those products one url at a time,
 * which only works for brands with a live resolver — the same registry
 * `/api/resolve` uses.
 */
export interface RepriceResult {
  /** Tracked, stale, resolvable products this run picked up. */
  considered: number;
  /** Fetched successfully. */
  repriced: number;
  /** Of those, how many had actually moved. */
  changed: number;
  events: number;
  failed: number;
}

const LIMIT = Number(process.env.REPRICE_LIMIT ?? 250);
/**
 * Older than this and the sweep clearly did not touch it this run. The schedule
 * is 90 minutes and this pass runs at the end of one, so 45 leaves a wide margin
 * either side of a slow crawl without ever re-checking something just seen.
 */
const STALE_MINUTES = Number(process.env.REPRICE_STALE_MINUTES ?? 45);
/**
 * Low on purpose. These are single product pages on one shop's origin, not a
 * paginated API, and the pass runs after a crawl that has already spent that
 * host's goodwill.
 */
const CONCURRENCY = Number(process.env.REPRICE_CONCURRENCY ?? 4);

export async function repriceTracked(db: Db, brands = liveBrands()): Promise<RepriceResult> {
  const out: RepriceResult = { considered: 0, repriced: 0, changed: 0, events: 0, failed: 0 };
  if (brands.length === 0) return out;

  // The database clock, not this process's — the collector runs on a different
  // machine from the database and a few seconds of skew either way would drop
  // products from the window or pull in ones just written.
  // `new Date(x)` rather than `Date.parse` — the two drivers disagree about
  // whether `now()` comes back as an ISO string or a Date, and `Date.parse` of
  // a Date is NaN, which would silently make the cutoff invalid and match
  // nothing.
  const cutoff = new Date(new Date(await dbNow(db)).getTime() - STALE_MINUTES * 60_000).toISOString();
  const candidates = await listRepriceCandidates(db, brands, cutoff, LIMIT);
  out.considered = candidates.length;
  if (candidates.length === 0) return out;

  const prevByProduct = await latestSnapshots(db, candidates.map((c) => c.id));
  const snapRows: { productId: number; price: number; listPrice: number | null; inStock: boolean }[] = [];
  const eventRows: { productId: number; e: ReturnType<typeof diff>[number] }[] = [];

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
      while (cursor < candidates.length) {
        const c = candidates[cursor++];
        const live = await lookupLive(c.brand, c.url);
        if (!live) {
          // Leave the row untouched — including `last_seen`, so it stays at the
          // head of the queue and is retried next run. Writing a failure as
          // "checked" would quietly drop it out of the window for good.
          out.failed++;
          continue;
        }
        out.repriced++;

        const curr = { price: live.price, listPrice: live.listPrice, inStock: live.inStock };
        const prev = prevByProduct.get(c.id) ?? null;
        if (prev && (prev.price !== curr.price || prev.listPrice !== curr.listPrice || prev.inStock !== curr.inStock)) {
          out.changed++;
          snapRows.push({ productId: c.id, ...curr });
          for (const e of diff(prev, curr)) eventRows.push({ productId: c.id, e });
        } else if (!prev) {
          // No history at all. Record the point, but emit nothing: `diff(null, …)`
          // means new_product, and a product someone has been tracking for a week
          // announcing itself as new is a notification we would have to apologise
          // for.
          snapRows.push({ productId: c.id, ...curr });
        }
        await applyReprice(db, { id: c.id, ...curr });
      }
    }),
  );

  await insertSnapshots(db, snapRows);
  await insertEvents(db, eventRows);
  out.events = eventRows.length;
  return out;
}
