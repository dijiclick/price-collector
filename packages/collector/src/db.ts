import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProductRecord, PriceEvent, Snap, ProductVariants } from "./types";
import { classifyType } from "./productType";
import { subtypeForName } from "../../../lib/productTypes";

/** Minimal row-returning query interface both Neon (postgres.js) and PGlite satisfy. */
export interface Db {
  query<T = any>(text: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
}

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../../..", "db", "schema.sql");

/**
 * Run `fn`, retrying on failure with exponential backoff (2s, 4s, 8s, 16s
 * between the 5 attempts by default — ~30s worst case). Exported for tests.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 2000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        console.warn(`db connect attempt ${attempt}/${attempts} failed, retrying in ${delay / 1000}s:`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Connect to Postgres. Uses Neon (via `postgres`) when DATABASE_URL is set,
 * otherwise an embedded PGlite database (local dev / CI / e2e).
 *
 * Falling back to PGlite must be *asked for*, via PGLITE_DIR. It used to happen
 * automatically whenever DATABASE_URL was absent, which meant a misconfigured
 * production run quietly collected into a local throwaway file and reported
 * success — a whole scheduled run looked healthy while writing nothing to the
 * real database. An unset DATABASE_URL is now a startup error.
 */
export async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { ssl: "require", max: 5 });
    // postgres.js connects lazily, so a transient Neon cold-start/network blip
    // used to surface at the first real query and kill the whole scheduled run
    // ~35s in (ETIMEDOUT). Probe up front with backoff so a blip delays the run
    // instead of failing it.
    try {
      await withRetries(() => sql.unsafe("SELECT 1") as unknown as Promise<any[]>);
    } catch (err) {
      await sql.end().catch(() => {});
      throw err;
    }
    return {
      query: (text, params = []) => sql.unsafe(text, params) as unknown as Promise<any[]>,
      close: () => sql.end(),
    };
  }
  const dir = process.env.PGLITE_DIR;
  if (!dir) {
    throw new Error(
      "DATABASE_URL is not set. Refusing to fall back to a local PGlite database — " +
        "that would silently collect into a throwaway file. Set DATABASE_URL, or set " +
        "PGLITE_DIR to opt into the embedded database deliberately.",
    );
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dir);
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows as any[],
    close: () => pg.close(),
  };
}

export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(schemaPath, "utf8");
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    try {
      await db.query(stmt);
    } catch (err) {
      // schema uses IF NOT EXISTS; ignore benign "already exists" races
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(msg)) throw err;
    }
  }
}

const key = (brand: string, externalId: string) => brand + "|" + externalId;

/** Build a multi-row VALUES clause ($1,$2,...) for `rows` each with `cols` columns. */
function placeholders(rowCount: number, cols: number): string {
  const groups: string[] = [];
  let n = 1;
  for (let r = 0; r < rowCount; r++) {
    const g: string[] = [];
    for (let c = 0; c < cols; c++) g.push("$" + n++);
    groups.push("(" + g.join(",") + ")");
  }
  return groups.join(",");
}

async function inChunks<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Bulk upsert products; returns Map of `brand|externalId` -> product id. */
/**
 * Fingerprint of everything the upsert would actually write.
 *
 * Fields the SQL COALESCEs (variants, gender, barcodes) are included only when
 * the incoming value is non-null, because a null leaves the stored value alone
 * and so is not a change. That matters for Zara, which captures sizes for a
 * rotating subset each run — hashing its nulls would make every product look
 * changed on the runs that skipped it.
 *
 * `currency` is deliberately absent: it appears in the INSERT but not the
 * DO UPDATE list, so a changed currency never lands on an existing row anyway.
 */
export function contentHash(r: ProductRecord): string {
  const h = createHash("sha1");
  h.update(
    JSON.stringify([
      r.name, r.url, r.imageUrl ?? null, r.category ?? null,
      classifyType(r.category, r.name),
      subtypeForName(classifyType(r.category, r.name), r.name),
      r.groupKey ?? null, r.colorName ?? null,
      r.price, r.listPrice ?? null, r.inStock,
      r.variants ?? undefined,
      r.gender ?? undefined,
      r.barcodes?.length ? r.barcodes : undefined,
    ]),
  );
  return h.digest("hex");
}

/**
 * Write products, skipping the expensive path for rows that did not change.
 *
 * The full 16-column upsert ships ~16 parameters per product to a remote
 * Postgres; Beymen alone sent ~700k of them per run to record two actual price
 * changes, and `last_seen=now()` guaranteed every tuple was rewritten regardless.
 * So: read the current fingerprints (three narrow columns), upsert only the rows
 * that are new or genuinely different, and bump `last_seen` for the rest with a
 * single array UPDATE per chunk. Delisting still works because it keys off
 * `last_seen < runStart`, which the cheap path maintains.
 */
export async function upsertProducts(db: Db, records: ProductRecord[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (records.length === 0) return map;

  // Existing fingerprints for every brand in this batch (normally exactly one).
  const brands = [...new Set(records.map((r) => r.brand))];
  const known = new Map<string, { id: number; hash: string | null }>();
  const existing = await db.query<{ id: number; brand: string; external_id: string; content_hash: string | null }>(
    "SELECT id, brand, external_id, content_hash FROM products WHERE brand = ANY($1)",
    [brands],
  );
  for (const row of existing) {
    known.set(key(row.brand, row.external_id), { id: row.id, hash: row.content_hash });
  }

  const changed: { rec: ProductRecord; hash: string }[] = [];
  const unchanged: ProductRecord[] = [];
  for (const r of records) {
    const hash = contentHash(r);
    const prev = known.get(key(r.brand, r.externalId));
    if (prev && prev.hash === hash) {
      unchanged.push(r);
      map.set(key(r.brand, r.externalId), prev.id);
    } else {
      changed.push({ rec: r, hash });
    }
  }

  // Unchanged: nothing to write but the freshness marker delisting reads.
  await inChunks(unchanged, 5000, async (chunk) => {
    await db.query(
      "UPDATE products SET last_seen=now() WHERE brand=$1 AND external_id = ANY($2)",
      [chunk[0].brand, chunk.map((r) => r.externalId)],
    );
  });

  await upsertChanged(db, changed, map);
  return map;
}

async function upsertChanged(
  db: Db,
  changed: { rec: ProductRecord; hash: string }[],
  map: Map<string, number>,
): Promise<void> {
  await inChunks(changed, 500, async (chunk) => {
    const params: any[] = [];
    for (const { rec: r, hash } of chunk) {
      // Pass the object as-is: postgres.js serialises it to JSONB. Stringifying
      // here would double-encode it (stored as a JSON *string*, not an object).
      params.push(r.brand, r.externalId, r.name, r.url, r.imageUrl, r.category ?? null,
        classifyType(r.category, r.name), subtypeForName(classifyType(r.category, r.name), r.name),
        r.variants ?? null, r.groupKey ?? null, r.colorName ?? null,
        r.gender ?? null, r.barcodes?.length ? r.barcodes : null,
        r.price, r.listPrice, r.currency, r.inStock, hash);
    }
    const rows = await db.query<{ id: number; brand: string; external_id: string }>(
      "INSERT INTO products (brand, external_id, name, url, image_url, category, product_type, product_subtype, variants, group_key, color_name, gender, barcodes," +
        " current_price, current_list_price, currency, in_stock, content_hash) VALUES " +
        placeholders(chunk.length, 18) +
        " ON CONFLICT (brand, external_id) DO UPDATE SET" +
        " name=EXCLUDED.name, url=EXCLUDED.url, image_url=EXCLUDED.image_url," +
        " category=EXCLUDED.category, product_type=EXCLUDED.product_type," +
        " product_subtype=EXCLUDED.product_subtype," +
        // keep previously-captured variants when a run doesn't re-fetch them
        // (Zara captures sizes for a rotating subset each run).
        " variants=COALESCE(EXCLUDED.variants, products.variants)," +
        // keep a previously-known gender when a run can't derive it (adapters
        // stamp gender from the section tree; not every code path knows it).
        " gender=COALESCE(EXCLUDED.gender, products.gender)," +
        // same rule as gender: a run that couldn't read a barcode must not
        // erase one we already have.
        " barcodes=COALESCE(EXCLUDED.barcodes, products.barcodes)," +
        " group_key=EXCLUDED.group_key, color_name=EXCLUDED.color_name," +
        " current_price=EXCLUDED.current_price," +
        " current_list_price=EXCLUDED.current_list_price, in_stock=EXCLUDED.in_stock," +
        " content_hash=EXCLUDED.content_hash," +
        " last_seen=now() RETURNING id, brand, external_id",
      params,
    );
    for (const row of rows) map.set(key(row.brand, row.external_id), row.id);
  });
}

/** DB clock — so "seen this run" comparisons don't depend on the client's clock. */
export async function dbNow(db: Db): Promise<string> {
  const rows = await db.query<{ t: string }>("SELECT now() AS t");
  return rows[0].t;
}

/** How many of a brand's products are currently in stock (health guard). */
export async function countInStock(db: Db, brand: string): Promise<number> {
  const rows = await db.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM products WHERE brand=$1 AND in_stock=TRUE",
    [brand],
  );
  return rows[0]?.c ?? 0;
}

/**
 * Mark a brand's products that this run didn't see as out of stock. Brands drop
 * sold-out items from their listings, so "no longer listed" is our only signal
 * that something is gone — without this they'd sit in the feed forever at their
 * last known price.
 */
/**
 * `protectTracked` exempts products someone is tracking from the delist sweep.
 *
 * Pass it only for brands whose products can be re-checked one url at a time.
 * For those, "the sweep did not see it" no longer means "it is gone": Mango's
 * adapter walks sale listings only, so every full-price product it holds — which
 * is precisely what on-demand lookups add — is missing from every single run.
 * Without this, a product a user tracked ten minutes ago is marked out of stock
 * on the next crawl and shows as unavailable in the app.
 *
 * The exemption is deliberately narrow. For a brand with no resolver a tracked
 * product that vanishes from the listing really has gone, and must still be
 * marked — otherwise nothing would ever delist the items people care most about.
 */
export async function markMissingOutOfStock(
  db: Db,
  brand: string,
  since: string,
  protectTracked = false,
): Promise<number> {
  const guard = protectTracked
    ? ` AND NOT EXISTS (
         SELECT 1 FROM push_watch w WHERE w.product_id = products.id
         UNION ALL SELECT 1 FROM watchlist w2 WHERE w2.product_id = products.id
         UNION ALL SELECT 1 FROM user_watch w3 WHERE w3.product_id = products.id
       )`
    : "";
  const rows = await db.query<{ id: number }>(
    "UPDATE products SET in_stock=FALSE WHERE brand=$1 AND in_stock=TRUE AND last_seen < $2" +
      guard +
      " RETURNING id",
    [brand, since],
  );
  return rows.length;
}

export interface RepriceCandidate {
  id: number;
  brand: string;
  url: string;
}

/**
 * Tracked products of `brands` that this run's sweep did not refresh.
 *
 * Tracked only, on purpose: re-checking is one HTTP request per product against
 * a live shop, so it is spent on the products a drop alert can actually fire
 * for. An on-demand product nobody tracks is a search result, and the next
 * search re-resolves it anyway.
 *
 * Stalest first, so a capped run rotates through the backlog instead of
 * re-checking the same head of the list forever.
 */
export async function listRepriceCandidates(
  db: Db,
  brands: string[],
  cutoff: string,
  limit: number,
): Promise<RepriceCandidate[]> {
  if (brands.length === 0 || limit <= 0) return [];
  const brandSlots = brands.map((_, i) => "$" + (i + 1)).join(",");
  return db.query<RepriceCandidate>(
    `SELECT id, brand, url FROM products p
      WHERE brand IN (${brandSlots})
        AND last_seen < $${brands.length + 1}
        AND EXISTS (
          SELECT 1 FROM push_watch w WHERE w.product_id = p.id
          UNION ALL SELECT 1 FROM watchlist w2 WHERE w2.product_id = p.id
          UNION ALL SELECT 1 FROM user_watch w3 WHERE w3.product_id = p.id
        )
      ORDER BY last_seen ASC
      LIMIT $${brands.length + 2}`,
    [...brands, cutoff, limit],
  );
}

/**
 * Write one re-checked product back.
 *
 * `last_seen` is bumped even when nothing moved — that is the whole record of
 * "we looked and it was fine", and it is what stops the same product being
 * picked first on every subsequent run.
 */
export async function applyReprice(
  db: Db,
  row: { id: number; price: number; listPrice: number | null; inStock: boolean },
): Promise<void> {
  await db.query(
    `UPDATE products
        SET current_price = $2, current_list_price = $3, in_stock = $4, last_seen = now()
      WHERE id = $1`,
    [row.id, row.price, row.listPrice, row.inStock],
  );
}

/** Fetch the latest snapshot for each of `productIds` in one pass. */
export async function latestSnapshots(db: Db, productIds: number[]): Promise<Map<number, Snap>> {
  const map = new Map<number, Snap>();
  await inChunks(productIds, 1000, async (chunk) => {
    const rows = await db.query<any>(
      "SELECT DISTINCT ON (product_id) product_id, price, list_price, in_stock FROM snapshots WHERE product_id IN (" +
        placeholders(chunk.length, 1) +
        ") ORDER BY product_id, ts DESC",
      chunk,
    );
    for (const r of rows) map.set(r.product_id, { price: r.price, listPrice: r.list_price, inStock: r.in_stock });
  });
  return map;
}

export async function insertSnapshots(
  db: Db,
  rows: { productId: number; price: number; listPrice: number | null; inStock: boolean }[],
): Promise<void> {
  await inChunks(rows, 500, async (chunk) => {
    const params: any[] = [];
    for (const s of chunk) params.push(s.productId, s.price, s.listPrice, s.inStock);
    await db.query(
      "INSERT INTO snapshots (product_id, price, list_price, in_stock) VALUES " + placeholders(chunk.length, 4),
      params,
    );
  });
}

/**
 * Cap how many snapshots we keep per product (newest first). With change-only
 * inserts a product only accrues a row per real price/stock change, so this
 * rarely deletes anything — it's a backstop against a product that flip-flops.
 */
export async function pruneSnapshots(db: Db, keepPerProduct = 120): Promise<number> {
  const rows = await db.query<{ id: number }>(
    `DELETE FROM snapshots s USING (
       SELECT id, row_number() OVER (PARTITION BY product_id ORDER BY ts DESC, id DESC) AS rn
       FROM snapshots
     ) d WHERE s.id = d.id AND d.rn > $1 RETURNING s.id`,
    [keepPerProduct],
  );
  return rows.length;
}

export async function insertEvents(db: Db, rows: { productId: number; e: PriceEvent }[]): Promise<void> {
  await inChunks(rows, 500, async (chunk) => {
    const params: any[] = [];
    for (const { productId, e } of chunk) params.push(productId, e.type, e.oldPrice, e.newPrice, e.pct, e.size ?? null);
    await db.query(
      "INSERT INTO events (product_id, type, old_price, new_price, pct, size) VALUES " + placeholders(chunk.length, 6),
      params,
    );
  });
}

/**
 * Sizes that some watcher (email or push) asked to be alerted about, keyed by
 * product id. Bounds per-size back_in_stock events to what someone actually
 * watches, so the events table doesn't fill with restocks nobody cares about.
 */
export async function getWatchedSizes(db: Db): Promise<Map<number, Set<string>>> {
  const rows = await db.query<{ product_id: number; size: string }>(
    `SELECT product_id, size FROM push_watch WHERE size IS NOT NULL
     UNION
     SELECT product_id, size FROM watchlist WHERE size IS NOT NULL`,
  );
  const map = new Map<number, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, new Set());
    map.get(r.product_id)!.add(r.size);
  }
  return map;
}

/** Current per-size availability for the given ids — read BEFORE an upsert
 * overwrites `products.variants`, to serve as the "previous" state. */
export async function getVariantsByIds(
  db: Db,
  ids: number[],
): Promise<Map<number, ProductVariants["sizes"]>> {
  const map = new Map<number, ProductVariants["sizes"]>();
  if (ids.length === 0) return map;
  const rows = await db.query<{ id: number; variants: ProductVariants | null }>(
    `SELECT id, variants FROM products WHERE id = ANY($1::int[])`,
    [ids],
  );
  for (const r of rows) map.set(r.id, r.variants?.sizes ?? []);
  return map;
}

export { key };
