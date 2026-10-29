import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProductRecord, PriceEvent, Snap, ProductVariants } from "./types";
import { classifyType } from "./productType";
import { cleanListPrice } from "./normalize";
import { subtypeForName } from "../../../lib/productTypes";
import { makerOf } from "../../../lib/maker";
import { resolveGender } from "../../../lib/gender";
import { colorFamilies } from "../../../lib/colors";
import { DEFAULT_COUNTRY } from "../../../lib/countries";
import { mergeInStockSizes } from "./sizes";

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

/**
 * Apply db/schema.sql, every run.
 *
 * Each statement runs under a 3s lock_timeout. `ALTER TABLE … IF NOT EXISTS`
 * takes an ACCESS EXCLUSIVE lock BEFORE it checks whether there is anything to
 * do, so a no-op ALTER queued behind one long read stalls every query on that
 * table behind it — the API included. 2026-10-03: an 11-minute stale-recheck
 * SELECT plus four parallel collector jobs migrating at startup held the feed
 * at 60s timeouts until the queries were cancelled by hand. The schema is
 * almost always already in place, so a statement that cannot get its lock is
 * skipped with a warning rather than waited on; a genuinely new column is
 * applied by hand on production first anyway.
 */
export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(schemaPath, "utf8");
  let catalog = await readCatalog(db);
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    // Even a no-op ALTER/CREATE INDEX takes its table lock first, and every
    // collector job (27 markets × several runs an hour) migrates at startup:
    // each one parked the feed behind a lock for up to 3 s (2026-10-23, the
    // speed guard's "app is slow" mail). Statements whose result is already in
    // the catalog are skipped without touching the table at all.
    if (catalog && alreadyApplied(stmt, catalog)) continue;
    const guarded = `DO $migrate$ BEGIN PERFORM set_config('lock_timeout', '3s', true); EXECUTE $stmt$${stmt}$stmt$; END $migrate$`;
    try {
      await db.query(/^(--[^\n]*\n\s*)*(ALTER|CREATE)\b/i.test(stmt) ? guarded : stmt);
      // Something changed (a fresh database creates its tables here): read the
      // catalog again so later statements are judged against what now exists.
      if (catalog && /^(--[^\n]*\n\s*)*(ALTER|CREATE|DO)\b/i.test(stmt)) catalog = await readCatalog(db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // schema uses IF NOT EXISTS; ignore benign "already exists" races
      if (/already exists/i.test(msg)) continue;
      if (/lock timeout/i.test(msg)) {
        console.warn(`migrate: skipped (table busy): ${stmt.replace(/--[^\n]*\n/g, "").trim().slice(0, 90)}`);
        continue;
      }
      throw err;
    }
  }
}

/** What the database already has, read from the catalog (no table locks). */
export interface SchemaCatalog {
  /** "table.column", lowercased. */
  columns: Set<string>;
  /** Tables, indexes and other relations in the search path, lowercased. */
  relations: Set<string>;
  /** Constraint names, lowercased. */
  constraints: Set<string>;
  /** Installed extensions. */
  extensions: Set<string>;
}

async function readCatalog(db: Db): Promise<SchemaCatalog | null> {
  try {
    const cols = await db.query<{ t: string; c: string }>(
      "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()",
    );
    const rels = await db.query<{ n: string }>(
      "SELECT c.relname AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = current_schema()",
    );
    const cons = await db.query<{ n: string }>(
      "SELECT con.conname AS n FROM pg_constraint con JOIN pg_namespace s ON s.oid = con.connamespace WHERE s.nspname = current_schema()",
    );
    const exts = await db.query<{ n: string }>("SELECT extname AS n FROM pg_extension");
    return {
      columns: new Set(cols.map((r) => `${r.t}.${r.c}`.toLowerCase())),
      relations: new Set(rels.map((r) => r.n.toLowerCase())),
      constraints: new Set(cons.map((r) => r.n.toLowerCase())),
      extensions: new Set(exts.map((r) => r.n.toLowerCase())),
    };
  } catch {
    return null; // no catalog → run every statement, as before
  }
}

/**
 * True when running `stmt` could not change anything the catalog shows:
 * every table/index it would create exists, every column it would add is
 * there, and the constraint it would drop is gone. Anything it cannot read
 * with certainty returns false and runs as before.
 */
export function alreadyApplied(raw: string, cat: SchemaCatalog): boolean {
  const stmt = raw.replace(/--[^\n]*(\n|$)/g, " ").replace(/\s+/g, " ").trim();
  const name = (s: string) => s.replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
  if (!stmt) return true; // a chunk that is only comments
  let m: RegExpMatchArray | null;
  if ((m = stmt.match(/^CREATE TABLE IF NOT EXISTS ([\w."]+)/i))) return cat.relations.has(name(m[1]));
  if ((m = stmt.match(/^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS ([\w"]+)/i))) return cat.relations.has(name(m[1]));
  if ((m = stmt.match(/^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([\w."]+) (.*)$/i))) {
    const table = name(m[1]);
    const body = m[2];
    const drop = body.match(/^DROP CONSTRAINT IF EXISTS ([\w"]+)$/i);
    if (drop) return !cat.constraints.has(name(drop[1]));
    // Only a pure "ADD COLUMN IF NOT EXISTS …[, ADD COLUMN IF NOT EXISTS …]".
    if (!/^ADD COLUMN IF NOT EXISTS /i.test(body)) return false;
    if (/\b(ALTER COLUMN|DROP|ADD CONSTRAINT|RENAME|OWNER TO|ENABLE|DISABLE|VALIDATE)\b/i.test(body)) return false;
    const added = [...body.matchAll(/ADD COLUMN IF NOT EXISTS ([\w"]+)/gi)].map((x) => name(x[1]));
    const clauses = body.split(/,\s*(?=ADD\b)/i).length;
    if (added.length === 0 || added.length !== clauses) return false;
    return added.every((c) => cat.columns.has(`${table}.${c}`));
  }
  if (/^DO \$\$/i.test(stmt)) {
    if (/\b(ALTER|DROP|UPDATE|INSERT|DELETE)\b/i.test(stmt)) return false;
    const exts = [...stmt.matchAll(/CREATE EXTENSION IF NOT EXISTS ([\w"]+)/gi)].map((x) => name(x[1]));
    const rels = [...stmt.matchAll(/CREATE (?:UNIQUE )?(?:INDEX|TABLE) (?:CONCURRENTLY )?IF NOT EXISTS ([\w"]+)/gi)].map((x) => name(x[1]));
    if (exts.length + rels.length === 0) return false;
    return exts.every((e) => cat.extensions.has(e)) && rels.every((r) => cat.relations.has(r));
  }
  return false;
}

/**
 * A product's identity, as one string.
 *
 * Country sits in the middle because it sits in the middle of the unique index
 * too — `(brand, country, external_id)`. Leaving it out is not a cosmetic bug:
 * the map would collide a TR and an AE row on one entry and the second country
 * collected would overwrite the first country's snapshots and events.
 */
const key = (brand: string, country: string, externalId: string) =>
  brand + "|" + country + "|" + externalId;

/** Absent country means Turkey — see ProductRecord.country. */
const countryOf = (r: { country?: string }): string => r.country ?? DEFAULT_COUNTRY;

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
 *
 * `country` is absent for a different reason: it is part of the KEY, like brand
 * and external id. Hashing it would mean every existing row's fingerprint
 * changed the day the column shipped, forcing a full rewrite of ~160k rows to
 * record nothing.
 */
export function contentHash(r: ProductRecord): string {
  const h = createHash("sha1");
  const parts: unknown[] = [
    r.name, r.url, r.imageUrl ?? null, r.category ?? null,
    classifyType(r.category, r.name, r.brand, makerOf(r)),
    subtypeForName(classifyType(r.category, r.name, r.brand, makerOf(r)), r.name, r.brand, r.category, makerOf(r)),
    r.groupKey ?? null, r.colorName ?? null,
    r.price, r.listPrice ?? null, r.inStock,
    r.variants ?? undefined,
    r.gender ?? undefined,
    r.barcodes?.length ? r.barcodes : undefined,
  ];
  // Appended only when present, unlike the fields above: an absent gallery
  // keeps every existing fingerprint unchanged, while a product that gains one
  // hashes differently ONCE — which is exactly what writes the backfill.
  if ((r.images?.length ?? 0) > 1) parts.push(r.images);
  // Same rule: a maker (lib/maker.ts) rewrites a row once when it first appears.
  const maker = makerOf(r);
  if (maker) parts.push({ maker });
  h.update(JSON.stringify(parts));
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

  // Every brand passes through here, so this is where the "a list price must
  // actually be above the price" invariant is enforced once instead of in
  // twenty adapters — two of which had quietly stopped doing it. Applied before
  // the content hash so a record whose only change is a bogus list price does
  // not churn the row. See cleanListPrice.
  records = records.map((r) =>
    r.listPrice === cleanListPrice(r.price, r.listPrice) ? r : { ...r, listPrice: cleanListPrice(r.price, r.listPrice) },
  );
  // In-stock-only size lists keep the stored sold-out sizes (sizes.ts). Before
  // the hash, so an unchanged merged list does not churn the row.
  records = await mergeStoredSizes(db, records);

  // Existing fingerprints for every brand AND country in this batch (normally
  // exactly one of each). Scoped by country as well so a Zara/AE run reads
  // 30k AE fingerprints instead of the 60k TR+AE pile.
  const brands = [...new Set(records.map((r) => r.brand))];
  const countries = [...new Set(records.map(countryOf))];
  const known = new Map<string, { id: number; hash: string | null }>();
  const existing = await db.query<{ id: number; brand: string; country: string; external_id: string; content_hash: string | null }>(
    "SELECT id, brand, country, external_id, content_hash FROM products WHERE brand = ANY($1) AND country = ANY($2)",
    [brands, countries],
  );
  for (const row of existing) {
    known.set(key(row.brand, row.country, row.external_id), { id: row.id, hash: row.content_hash });
  }

  const changed: { rec: ProductRecord; hash: string }[] = [];
  const unchanged: ProductRecord[] = [];
  for (const r of records) {
    const hash = contentHash(r);
    const k = key(r.brand, countryOf(r), r.externalId);
    const prev = known.get(k);
    if (prev && prev.hash === hash) {
      unchanged.push(r);
      map.set(k, prev.id);
    } else {
      changed.push({ rec: r, hash });
    }
  }

  // Unchanged: nothing to write but the freshness marker delisting reads —
  // and the stock flag. The fingerprint says what the adapter last REPORTED,
  // but `in_stock` can have moved without it: the delist sweep sets it false
  // for a product one run missed. When that product came back the next run
  // found the fingerprint unchanged and only bumped last_seen, so it stayed
  // "sold out" for good while the shop sold it (2026-10-22: 1,710 Zara TR
  // products, 47 of them live markdowns missing from the feed). Writing the
  // flag here is free — the UPDATE rewrites the row anyway.
  // Grouped by brand, country AND stock, because the UPDATE names all three: a
  // chunk that straddled two countries would bump one country's rows under the
  // other's external ids and silently leave real rows looking stale to the sweep.
  const byScope = new Map<string, ProductRecord[]>();
  for (const r of unchanged) {
    const scope = r.brand + "|" + countryOf(r) + "|" + (r.inStock ? 1 : 0);
    (byScope.get(scope) ?? byScope.set(scope, []).get(scope)!).push(r);
  }
  for (const group of byScope.values()) {
    await inChunks(group, 5000, async (chunk) => {
      await db.query(
        "UPDATE products SET last_seen=now(), in_stock=$4 WHERE brand=$1 AND country=$2 AND external_id = ANY($3)",
        [chunk[0].brand, countryOf(chunk[0]), chunk.map((r) => r.externalId), chunk[0].inStock],
      );
    });
  }

  await upsertChanged(db, changed, map);
  return map;
}

/**
 * Records flagged `sizesInStockOnly` get the stored sold-out sizes laid back in
 * (mergeInStockSizes). One narrow read per brand × market in the batch.
 */
async function mergeStoredSizes(db: Db, records: ProductRecord[]): Promise<ProductRecord[]> {
  const flagged = records.filter((r) => r.sizesInStockOnly && r.variants?.sizes?.length);
  if (flagged.length === 0) return records;
  const byScope = new Map<string, ProductRecord[]>();
  for (const r of flagged) {
    const scope = r.brand + "|" + countryOf(r);
    (byScope.get(scope) ?? byScope.set(scope, []).get(scope)!).push(r);
  }
  const stored = new Map<string, ProductVariants["sizes"]>();
  for (const group of byScope.values()) {
    const rows = await db.query<{ external_id: string; variants: ProductVariants | null }>(
      "SELECT external_id, variants FROM products WHERE brand=$1 AND country=$2 AND external_id = ANY($3) AND variants IS NOT NULL",
      [group[0].brand, countryOf(group[0]), group.map((r) => r.externalId)],
    );
    for (const row of rows) {
      const sizes = row.variants?.sizes;
      if (Array.isArray(sizes) && sizes.length) stored.set(key(group[0].brand, countryOf(group[0]), row.external_id), sizes);
    }
  }
  if (stored.size === 0) return records;
  return records.map((r) => {
    const prev = r.sizesInStockOnly && r.variants ? stored.get(key(r.brand, countryOf(r), r.externalId)) : undefined;
    return prev ? { ...r, variants: { ...r.variants!, sizes: mergeInStockSizes(prev, r.variants!.sizes) } } : r;
  });
}

/** External ids of one brand × market whose stored variants hold sizes (sizes.ts `sizedIds`). */
export async function getSizedExternalIds(db: Db, brand: string, country: string): Promise<Set<string>> {
  const rows = await db.query<{ external_id: string }>(
    "SELECT external_id FROM products WHERE brand=$1 AND country=$2" +
      " AND jsonb_typeof(variants->'sizes') = 'array' AND jsonb_array_length(variants->'sizes') > 0",
    [brand, country],
  );
  return new Set(rows.map((r) => r.external_id));
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
      params.push(r.brand, countryOf(r), r.externalId, r.name, r.url, r.imageUrl, r.category ?? null,
        classifyType(r.category, r.name, r.brand, makerOf(r)), subtypeForName(classifyType(r.category, r.name, r.brand, makerOf(r)), r.name, r.brand, r.category, makerOf(r)),
        r.variants ?? null, r.groupKey ?? null, r.colorName ?? null,
        // The name's own "Erkek"/"Kadın"/"Kız Çocuk" beats the section the
        // adapter crawled (lib/gender.ts); a silent name keeps the adapter's.
        resolveGender(r.gender, r.name), r.barcodes?.length ? r.barcodes : null,
        r.price, r.listPrice, r.currency, r.inStock, hash,
        // null when nothing names a colour, so the COALESCE below keeps what an
        // earlier run with variants found (Zara refetches sizes in rotation).
        (() => {
          const f = colorFamilies(r.colorName, r.variants?.colors, r.name, classifyType(r.category, r.name, r.brand, makerOf(r)));
          return f.length ? f : null;
        })(), makerOf(r));
    }
    const rows = await db.query<{ id: number; brand: string; country: string; external_id: string }>(
      "INSERT INTO products (brand, country, external_id, name, url, image_url, category, product_type, product_subtype, variants, group_key, color_name, gender, barcodes," +
        " current_price, current_list_price, currency, in_stock, content_hash, color_families, maker) VALUES " +
        placeholders(chunk.length, 21) +
        // The three-column unique INDEX from schema phase A. It must exist in
        // production before this ships, or every write errors "no unique or
        // exclusion constraint matching the ON CONFLICT specification".
        " ON CONFLICT (brand, country, external_id) DO UPDATE SET" +
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
        " color_families=COALESCE(EXCLUDED.color_families, products.color_families)," +
        " maker=COALESCE(EXCLUDED.maker, products.maker)," +
        " current_price=EXCLUDED.current_price," +
        " current_list_price=EXCLUDED.current_list_price, in_stock=EXCLUDED.in_stock," +
        " content_hash=EXCLUDED.content_hash," +
        " last_seen=now() RETURNING id, brand, country, external_id",
      params,
    );
    for (const row of rows) map.set(key(row.brand, row.country, row.external_id), row.id);

    // Galleries go to their own table (see db/schema.sql: product_images), only
    // for records whose adapter collected one — a record without `images`
    // leaves an existing gallery alone, like the COALESCEd columns above.
    const gallery: any[] = [];
    const single: number[] = [];
    for (const { rec: r } of chunk) {
      const id = map.get(key(r.brand, countryOf(r), r.externalId));
      if (id == null || !r.images) continue;
      // One photo is not a gallery: the product page shows imageUrl anyway.
      if (r.images.length > 1) gallery.push(id, r.images);
      else single.push(id);
    }
    // An adapter that now finds one photo (or stored one before this rule) clears the row.
    if (single.length) await db.query("DELETE FROM product_images WHERE product_id = ANY($1::int[])", [single]);
    if (gallery.length) {
      const values = Array.from({ length: gallery.length / 2 }, (_, i) => `($${2 * i + 1}::int, $${2 * i + 2}::text[])`).join(",");
      await db.query(
        `INSERT INTO product_images (product_id, urls) VALUES ${values}` +
          " ON CONFLICT (product_id) DO UPDATE SET urls = EXCLUDED.urls" +
          " WHERE product_images.urls IS DISTINCT FROM EXCLUDED.urls",
        gallery,
      );
    }
  });
}

/** DB clock — so "seen this run" comparisons don't depend on the client's clock. */
export async function dbNow(db: Db): Promise<string> {
  const rows = await db.query<{ t: string }>("SELECT now() AS t");
  return rows[0].t;
}

/**
 * How many of a brand's products are currently in stock, in ONE country
 * (health guard).
 *
 * Country-scoped for the same reason the delist sweep is. This number is what
 * the blocked-brand guard compares a run's yield against; judged against every
 * country's total, a first Emirati H&M run collecting nothing legitimately
 * would be reported as an IP block and fail the workflow forever.
 */
export async function countInStock(db: Db, brand: string, country: string): Promise<number> {
  const rows = await db.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM products WHERE brand=$1 AND country=$2 AND in_stock=TRUE",
    [brand, country],
  );
  return rows[0]?.c ?? 0;
}

/**
 * The most recent runs of one brand in one market, newest first: how many
 * products each collected and whether it errored. Feeds the delist guard's
 * "the catalogue really shrank" escape (`sweepLooksComplete`).
 */
export async function recentRuns(
  db: Db,
  brand: string,
  country: string,
  n: number,
): Promise<{ products: number; error: string | null }[]> {
  return db.query<{ products: number; error: string | null }>(
    "SELECT products, error FROM collector_runs WHERE brand=$1 AND country=$2 ORDER BY run_at DESC LIMIT $3",
    [brand, country, n],
  );
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
/**
 * `country` is not optional and must never become so.
 *
 * "This brand, and not seen since the run started" is true of every OTHER
 * country's rows on every run, because another country's sweep never touches
 * them. Scoped by brand alone, the first Emirati Zara run marks the entire
 * Turkish Zara catalogue out of stock — the live feed emptied, with a green tick
 * in the logs. This is risk 4 in the plan and the reason country landed in the
 * collector before a single adapter was parameterised.
 */
export async function markMissingOutOfStock(
  db: Db,
  brand: string,
  country: string,
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
    // content_hash=NULL: the stored fingerprint still says "in stock", so the
    // product's next sighting must take the full write, not the cheap path.
    "UPDATE products SET in_stock=FALSE, content_hash=NULL WHERE brand=$1 AND country=$2 AND in_stock=TRUE AND last_seen < $3" +
      guard +
      " RETURNING id",
    [brand, country, since],
  );
  return rows.length;
}

export interface RepriceCandidate {
  id: number;
  brand: string;
  /** Which market's listing this is — the live resolver needs it to ask the
   *  right storefront for the right currency. */
  country: string;
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
  opts: { premiumOnly?: boolean } = {},
): Promise<RepriceCandidate[]> {
  if (brands.length === 0 || limit <= 0) return [];
  const brandSlots = brands.map((_, i) => "$" + (i + 1)).join(",");
  // Premium instant alerts (priority.ts): only products a Premium device
  // tracks. push_devices.premium_until is written by the sync from a verified
  // purchase link, so a free device can never opt itself in.
  const tracked = opts.premiumOnly
    ? `SELECT 1 FROM push_watch w JOIN push_devices d ON d.token = w.token
        WHERE w.product_id = p.id AND d.premium_until > now()`
    : `SELECT 1 FROM push_watch w WHERE w.product_id = p.id
          UNION ALL SELECT 1 FROM watchlist w2 WHERE w2.product_id = p.id
          UNION ALL SELECT 1 FROM user_watch w3 WHERE w3.product_id = p.id`;
  // Deliberately NOT filtered by country: a tracked product is tracked whatever
  // market it came from, and this pass runs once per sweep. The country comes
  // back on the row instead, so the resolver can ask the right storefront.
  return db.query<RepriceCandidate>(
    `SELECT id, brand, country, url FROM products p
      WHERE brand IN (${brandSlots})
        AND last_seen < $${brands.length + 1}
        AND EXISTS (${tracked})
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
        SET current_price = $2, current_list_price = $3, in_stock = $4, last_seen = now(),
            -- The fingerprint no longer describes this row; the next listing
            -- sighting must rewrite price and stock rather than skip it.
            content_hash = NULL
      WHERE id = $1`,
    [row.id, row.price, row.listPrice, row.inStock],
  );
}

/**
 * A tracked product the shop says no longer exists (reprice.ts, "gone"): sold
 * out at its stored price, and `last_seen` bumped as for any check — "we looked
 * and it is gone" — so it leaves the head of the queue instead of being
 * retried first on every run.
 */
export async function markRepriceGone(db: Db, id: number): Promise<void> {
  await db.query(
    `UPDATE products SET in_stock = FALSE, last_seen = now(), content_hash = NULL WHERE id = $1`,
    [id],
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
