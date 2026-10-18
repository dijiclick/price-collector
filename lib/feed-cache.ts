/**
 * The feed cache: a compact copy of the rows the deal feed can show, and the
 * per-brand counts behind the full-catalogue browser.
 *
 * Why it exists (2026-10-10). `products` is ~2.2M rows in a 1.8 GB heap on a
 * Hetzner volume that sits at ~90% utilisation whenever the collector runs. The
 * Turkish feed is ~70k discounted rows, and they are scattered one per heap page,
 * so a cache-missed `/api/deals` read ~45k random pages: 20 s on the database,
 * 26 s at the endpoint. `/api/meta` ran eight such scans in parallel (13 s), and
 * its two full-catalogue tallies walked every in-stock row of the market. No
 * index fixes that — the cost is the heap pages, not finding the rows.
 *
 * So the collector copies what the feed needs into `feed_items` (one market's
 * deals in a few thousand dense pages, small enough to stay in shared_buffers)
 * and the catalogue tallies into `catalogue_counts`, right after it writes each
 * brand. The API reads these instead of `products`.
 *
 * This file is shared by the API (lib/db.ts) and the collector, so it must stay
 * platform-free: no "server-only", no Next imports. It travels to the public
 * collector repo through scripts/sync-collector-repo.mjs's allow-list.
 */

/**
 * What counts as current, in SQL — see the long note on `FRESH` in lib/db.ts,
 * which re-exports this. Defined here so the refresh and the readers can never
 * disagree about it.
 */
import { ACTIVE_COUNTRIES } from "./countries";

export const FRESH = "last_seen > now() - interval '48 hours'";

/** What counts as on sale, in SQL — re-exported by lib/db.ts, see the note there. */
export const DISCOUNTED =
  "current_list_price > current_price AND round(100.0 * (current_list_price - current_price) / current_list_price) >= 1";

/**
 * How old the newest refresh of a market may be before the API stops trusting
 * the cache and reads `products` again. Turkey refreshes every 90 minutes and
 * the international sweep every 4 hours, so 8 hours is two missed sweeps.
 * Anything older means the collector stopped refreshing (or never started —
 * a deploy that reached the API before the collector), and a stale feed is
 * worse than a slow one.
 */
export const FEED_MAX_AGE_HOURS = 8;

/**
 * Not fashion or beauty at all (2026-10-18 audit of every brand's women's feed:
 * ~2% was bed sheets, plates, furniture, snacks and supplements — Lefties'
 * /home/ shop, Yargıcı's "Mobilya", Vakko's "Nevresim Takımları", Gratis'
 * "Atıştırmalık"). Read from the store's own section first; a bare name only
 * counts when the classifier found no product type in it, so "Pike T-shirt"
 * (piqué) and "Halı Saha Ayakkabısı" (football boots) stay.
 *
 * Text is folded the way lib/productTypes.ts folds it (İ/ı/ç/ğ/ö/ş/ü → ascii)
 * because Postgres lower() turns "İ" into "i̇" and the patterns would miss it.
 */
const foldSql = (col: string) => `lower(translate(coalesce(${col}, ''), 'İIıÇçĞğÖöŞşÜü', 'iiiccggoossuu'))`;
export const HOME_SECTION_RE =
  "(ev dekor|dekorasyon|mobilya|mutfak|sofra|atistirmalik|gida|takviye|kitap|dergi|havlu set|nevresim|yatak ortusu|battaniye|throw|mum &|oda kokusu|oda & araba|aydinlatma|banyo aksesuar|catal|bardak|kirtasiye|oyuncak|ev tekstil|^hali$)";
export const HOME_NAME_RE =
  "(\\mtabak\\M|\\mkase\\M|carsaf|nevresim|yastik kilifi|vazo|mumluk|\\mtava\\M|tencere|\\mkupa\\M|bardak|paspas|protein bar|sakiz|biblo|sehpa|sandalye|abajur|\\mtablo\\M|cerceve|bed linen|duvet cover|pillowcase|cushion cover|place mat|serving board|candle holder|storage basket|table lamp|sengesett|putetrekk|lysestake|oppbevaring|bordlampe|bettwäsche|kissenbezug|vorhang|kerzenhalter|tischlampe|\\mball\\M|bälle)";
export const HOME_URL_RE = "^https?://[^/]+/([a-z]{2}(-[a-z]{2})?/)?home/";
export const notHomeGoods = (a: string) => `NOT (
       (${foldSql(`${a}.category`)} ~ '${HOME_SECTION_RE}' AND ${a}.product_type IS DISTINCT FROM 'ayakkabi')
    OR (${a}.product_type IS NULL AND ${foldSql(`${a}.name`)} ~ '${HOME_NAME_RE}')
    OR coalesce(${a}.url, '') ~* '${HOME_URL_RE}')`;

/** Rows a feed row needs; the order is the INSERT's column list. */
const FEED_COLS = [
  "id", "country", "brand", "currency", "name", "url", "image_url", "category",
  "product_type", "product_subtype", "gender", "group_key", "color_name", "color_families",
  "current_price", "current_list_price", "in_stock", "last_seen", "sizeless", "avail_sizes",
  "pct", "gk", "color_key", "maker",
] as const;

/**
 * The SELECT that turns a `products` row into a `feed_items` row.
 *
 * The superset every discount-gated reader needs: on sale, in stock, imaged,
 * fresh. The feed's junk-price floor and 90% cap are NOT applied here, because
 * the brand counts and the size chips never applied them — the readers keep
 * their own extra predicates, exactly as before.
 *
 * `variants` (the bulky part of a row) is reduced to the two facts the size
 * filter and the size chips use:
 *   sizeless    — no size axis at all, which the size filter lets through
 *   avail_sizes — upper(btrim(label)) of every size not out_of_stock
 * The CASE guards stand in for an OR whose evaluation order SQL does not
 * promise: jsonb_array_length() of a non-array raises.
 *
 * `pct`, `gk` and `color_key` are the feed query's per-row expressions, worked
 * out once here instead of on every request. On this 2-vCPU box the numeric
 * round() and the collation-aware sorts of those keys were most of a ~1 s
 * query even with every page in memory; gk/color_key are COLLATE "C" in the
 * table because they are only ever grouped and compared, never shown.
 */
const feedSelect = (scope: string, onSale = true) => `
  SELECT p.id, p.country, p.brand, p.currency, p.name, p.url, p.image_url, p.category,
         p.product_type, p.product_subtype, p.gender, p.group_key, p.color_name, p.color_families,
         p.current_price, p.current_list_price, p.in_stock, p.last_seen,
         CASE WHEN jsonb_typeof(p.variants->'sizes') = 'array'
              THEN jsonb_array_length(p.variants->'sizes') = 0 ELSE TRUE END AS sizeless,
         CASE WHEN jsonb_typeof(p.variants->'sizes') = 'array'
              THEN ARRAY(SELECT upper(btrim(s->>'label'))
                           FROM jsonb_array_elements(p.variants->'sizes') s
                          WHERE s->>'availability' <> 'out_of_stock') END AS avail_sizes,
         COALESCE(round(100.0 * (p.current_list_price - p.current_price)
                        / NULLIF(p.current_list_price, 0))::int, 0) AS pct,
         COALESCE(p.group_key, 'id:' || p.id::text) AS gk,
         COALESCE(NULLIF(lower(btrim(p.color_name)), ''), 'id:' || p.id::text) AS color_key,
         p.maker
    FROM products p
   WHERE ${scope}
     ${onSale ? `AND p.current_list_price IS NOT NULL AND ${DISCOUNTED.replace(/current_/g, "p.current_")}` : ""}
     AND p.image_url IS NOT NULL AND p.in_stock AND p.${FRESH}
     AND ${notHomeGoods("p")}`;

/**
 * The search catalogue (2026-10-11): the same compact rows as the feed cache,
 * but for EVERY live product of a market — discounted or not — because Stilist
 * and "show full price too" search the whole catalogue. On `products` that was
 * a heap walk of a 2.9 GB table on a 4 GB box: 4–12 s per query cold, and a
 * Stilist answer runs two or three of them. The Turkish catalogue is ~200k rows,
 * ~100 MB here, small enough to stay in memory. Other markets keep reading
 * `products` until they are added to this list (memory is the limit).
 */
// Every LAUNCHED market since 2026-10-11 (owner: "what about Canada and the
// others?") — TR, AE, SA, GB, US, CA, AU, CH, NO: ~820k rows, ~400 MB. Dense
// pages are fast even when a market's rows are not in memory, unlike the
// products heap, where one shelf is tens of thousands of scattered pages.
// Collected-but-unlaunched markets stay out: nobody can search them.
export const CATALOGUE_MARKETS: readonly string[] = ACTIVE_COUNTRIES;
export const catalogueMarket = (country: string): boolean => CATALOGUE_MARKETS.includes(country);

/**
 * The catalogue upsert writes a row only when something a reader sees changed,
 * or its `last_seen` is 12 h behind. Every sweep re-stamps last_seen on every
 * product, so an unconditional upsert would rewrite all ~1.7M rows on each run
 * on a disk already busy while the collector writes. 12 h keeps last_seen well
 * inside the 48 h freshness gate.
 */
const CATALOGUE_CHANGED = `WHERE f.last_seen < EXCLUDED.last_seen - interval '12 hours'
  OR (f.name, f.url, f.image_url, f.current_price, f.current_list_price, f.in_stock, f.product_type,
      f.product_subtype, f.gender, f.color_families, f.color_name, f.group_key, f.avail_sizes, f.sizeless, f.category,
      f.maker)
     IS DISTINCT FROM
     (EXCLUDED.name, EXCLUDED.url, EXCLUDED.image_url, EXCLUDED.current_price, EXCLUDED.current_list_price,
      EXCLUDED.in_stock, EXCLUDED.product_type, EXCLUDED.product_subtype, EXCLUDED.gender, EXCLUDED.color_families,
      EXCLUDED.color_name, EXCLUDED.group_key, EXCLUDED.avail_sizes, EXCLUDED.sizeless, EXCLUDED.category,
      EXCLUDED.maker)`;

const upsertSet = FEED_COLS.filter((c) => c !== "id")
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(", ");

/**
 * Re-copy one market's rows of one brand. One statement, so a reader sees the
 * brand's old rows or its new ones and never a half-written mix: upsert what
 * qualifies now, delete what no longer does. The DELETE runs against the
 * statement's starting snapshot, so it never sees the rows the upsert wrote.
 *
 * $1 country, $2 brand, $3 whether this sweep recorded a price_drop (stamps
 * `last_drop_at`, which the brand rail's "fresh drops" rings read).
 */
export const REFRESH_FEED_BRAND_SQL = `
  WITH src AS (${feedSelect("p.country = $1 AND p.brand = $2")}),
  up AS (
    INSERT INTO feed_items AS f (${FEED_COLS.join(", ")})
    SELECT ${FEED_COLS.join(", ")} FROM src
    ON CONFLICT (id) DO UPDATE SET ${upsertSet}
    RETURNING 1
  ),
  gone AS (
    DELETE FROM feed_items f
     WHERE f.country = $1 AND f.brand = $2
       AND NOT EXISTS (SELECT 1 FROM src WHERE src.id = f.id)
    RETURNING 1
  ),
  stamp AS (
    INSERT INTO feed_refresh (country, brand, refreshed_at, last_drop_at)
    VALUES ($1, $2, now(), CASE WHEN $3::boolean THEN now() END)
    ON CONFLICT (country, brand) DO UPDATE
      SET refreshed_at = now(), last_drop_at = COALESCE(EXCLUDED.last_drop_at, feed_refresh.last_drop_at)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up)::int AS kept, (SELECT count(*) FROM gone)::int AS removed,
         (SELECT count(*) FROM stamp)::int AS stamped`;

/**
 * Re-copy individual products — the reprice pass, which moves a handful of
 * tracked products between brand sweeps. $1 int[] of product ids.
 */
export const REFRESH_FEED_IDS_SQL = `
  WITH src AS (${feedSelect("p.id = ANY($1::int[])")}),
  up AS (
    INSERT INTO feed_items AS f (${FEED_COLS.join(", ")})
    SELECT ${FEED_COLS.join(", ")} FROM src
    ON CONFLICT (id) DO UPDATE SET ${upsertSet}
    RETURNING 1
  ),
  gone AS (
    DELETE FROM feed_items f
     WHERE f.id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM src WHERE src.id = f.id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up)::int AS kept, (SELECT count(*) FROM gone)::int AS removed`;

/** Re-copy one market's rows of one brand into the search catalogue. $1 country, $2 brand. */
export const REFRESH_CATALOGUE_ITEMS_BRAND_SQL = `
  WITH src AS (${feedSelect("p.country = $1 AND p.brand = $2", false)}),
  up AS (
    INSERT INTO catalogue_items AS f (${FEED_COLS.join(", ")})
    SELECT ${FEED_COLS.join(", ")} FROM src
    ON CONFLICT (id) DO UPDATE SET ${upsertSet}
    ${CATALOGUE_CHANGED}
    RETURNING 1
  ),
  gone AS (
    DELETE FROM catalogue_items f
     WHERE f.country = $1 AND f.brand = $2
       AND NOT EXISTS (SELECT 1 FROM src WHERE src.id = f.id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up)::int AS kept, (SELECT count(*) FROM gone)::int AS removed`;

/** Re-copy individual products into the search catalogue (reprice pass). $1 int[]. */
export const REFRESH_CATALOGUE_ITEMS_IDS_SQL = `
  WITH src AS (${feedSelect(`p.id = ANY($1::int[]) AND p.country = ANY(ARRAY[${CATALOGUE_MARKETS.map((c) => `'${c}'`).join(",")}]::text[])`, false)}),
  up AS (
    INSERT INTO catalogue_items AS f (${FEED_COLS.join(", ")})
    SELECT ${FEED_COLS.join(", ")} FROM src
    ON CONFLICT (id) DO UPDATE SET ${upsertSet}
    ${CATALOGUE_CHANGED}
    RETURNING 1
  ),
  gone AS (
    DELETE FROM catalogue_items f
     WHERE f.id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM src WHERE src.id = f.id)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up)::int AS kept, (SELECT count(*) FROM gone)::int AS removed`;

/**
 * Stamp brands whose products dropped in price outside a brand sweep (the
 * reprice pass). $1 text[] countries, $2 text[] brands, pairwise.
 */
export const STAMP_DROPS_SQL = `
  UPDATE feed_refresh r SET last_drop_at = now()
    FROM unnest($1::text[], $2::text[]) AS d(country, brand)
   WHERE r.country = d.country AND r.brand = d.brand`;

/**
 * Full-catalogue tallies for one brand in one market, replacing its previous
 * ones in the same statement. The gate is lib/db.ts's `dealBaseGate(country,
 * true)` — the browse-all feed's — so a category row's count still matches what
 * tapping it returns. $1 country, $2 brand, $3 the market's junk-price floor.
 */
export const REFRESH_CATALOGUE_SQL = `
  WITH gone AS (DELETE FROM catalogue_counts WHERE country = $1 AND brand = $2)
  INSERT INTO catalogue_counts (country, brand, product_type, product_subtype, gender, n)
  SELECT $1, $2, product_type, product_subtype, gender, count(*)::int
    FROM products
   WHERE country = $1 AND brand = $2
     AND image_url IS NOT NULL AND in_stock AND ${FRESH} AND current_price >= $3
     AND ${notHomeGoods("products")}
   GROUP BY product_type, product_subtype, gender`;

interface Queryable {
  query<T = any>(text: string, params?: any[]): Promise<T[]>;
}

/**
 * Refresh both caches for one brand in one market. Never throws: the collection
 * it follows has already been written, and a failed refresh only means the
 * cache is one sweep behind — the readers' freshness gate covers the rest.
 */
export async function refreshFeedCache(
  db: Queryable,
  country: string,
  brand: string,
  minPrice: number,
  dropped = false,
): Promise<{ kept: number; removed: number } | null> {
  try {
    const [r] = await db.query<{ kept: number; removed: number }>(REFRESH_FEED_BRAND_SQL, [country, brand, dropped]);
    await db.query(REFRESH_CATALOGUE_SQL, [country, brand, minPrice]);
    if (catalogueMarket(country)) await db.query(REFRESH_CATALOGUE_ITEMS_BRAND_SQL, [country, brand]);
    return { kept: Number(r?.kept ?? 0), removed: Number(r?.removed ?? 0) };
  } catch (err) {
    console.error(`feed cache refresh failed (${brand}/${country}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Refresh individual products in the feed cache, and stamp the brands among
 * `dropped` (country + brand of products that recorded a price_drop). Never
 * throws, like the above.
 */
export async function refreshFeedItems(
  db: Queryable,
  ids: number[],
  dropped: { country: string; brand: string }[] = [],
): Promise<void> {
  try {
    if (ids.length > 0) {
      await db.query(REFRESH_FEED_IDS_SQL, [ids]);
      await db.query(REFRESH_CATALOGUE_ITEMS_IDS_SQL, [ids]);
    }
    if (dropped.length > 0) {
      await db.query(STAMP_DROPS_SQL, [dropped.map((d) => d.country), dropped.map((d) => d.brand)]);
    }
  } catch (err) {
    console.error("feed cache refresh by id failed:", err instanceof Error ? err.message : err);
  }
}
