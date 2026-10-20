/**
 * The dead-link guard (2026-10-20): re-check product urls and hide the ones
 * that no longer open their product. Runs on the main box as
 * modadrop-links.timer (scripts/collector-host/modadrop-links.*), and on a
 * GitHub runner (scripts/collector-repo/links.yml, LINK_ONLY_HOSTS) for the
 * shops that refuse the box but answer a runner (Boyner, Rossmann).
 *
 *   tsx packages/collector/src/host/links.ts            # one pass
 *   LINK_DRY_RUN=1 … links.ts                           # check + log, write nothing
 *
 * WHAT IT CHECKS, most-opened first, a bounded batch per run:
 *   1. tracked products (push_watch, user_watch, watchlist) — every 12 h
 *   2. the deal feed (feed_items)                          — every 7 days
 *   3. the full catalogue (catalogue_items)                — every 30 days
 * plus anything with one strike (re-checked on the next run), and a few
 * random catalogue rows per shop so every shop in the batch has enough
 * checks for the anomaly test below. Tiers 2–3 read a TABLESAMPLE, not the
 * whole table: the box is 2 vCPUs shared with Postgres.
 *
 * WHEN A PRODUCT IS HIDDEN — only on clear evidence, twice:
 *   - link-check.ts says `gone` (404/410 on the product's own path) or `moved`
 *     (a redirect to a category/home page of the same shop). `moved` is only
 *     trusted for LINK_MOVED_COUNTRIES (default TR): this box is in Germany,
 *     and a foreign shop's redirects from here are geo redirects as often as
 *     not (calvinklein.us → .ie, coach.com → uk.coach.com).
 *   - two such checks in a row on the same url, the first at least 45 min
 *     before (one strike per run; the timer runs every 2 h).
 *   - and not part of a shop-wide anomaly: when more than half of a shop's
 *     decisive answers in one run are broken (n ≥ 8), it is a bot wall
 *     answering 404 (Zalando does), a geo redirect or an outage — never
 *     hundreds of genuinely dead products — so none of that shop's answers
 *     count this run. A systematic url bug is fixed in the adapter instead.
 * 403/429/5xx/timeouts are `unknown` and change nothing. After the first few
 * answers of a shop are all refusals the rest of its batch is skipped — no
 * point knocking on a wall, and it keeps the job polite.
 *
 * HIDING is the `linkOk` gate in lib/feed-cache.ts: the touched ids are
 * re-copied into feed_items/catalogue_items here (refreshFeedItems), every
 * brand sweep applies the same gate, and lib/db.ts reports a tracked product
 * with a dead link as out of stock. Nothing is ever deleted, and a later `ok`
 * (or the collector writing a different url) un-hides it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { connect, type Db } from "../db";
import { checkLink, type LinkResult } from "../link-check";
import { refreshFeedItems } from "../../../../lib/feed-cache";
import { ACTIVE_COUNTRIES } from "../../../../lib/countries";

export interface Candidate {
  id: number;
  country: string;
  brand: string;
  url: string;
  tier: number;
}

export interface Opts {
  countries: string[];
  movedCountries: string[];
  budget: number;
  perHost: number;
  minPerHost: number;
  concurrency: number;
  perHostConcurrency: number;
  gapMs: number;
  timeoutMs: number;
  dryRun: boolean;
  /** Only these shop hosts (www. stripped); empty = every shop. */
  onlyHosts: string[];
  /** Never these shop hosts, on top of the walls remembered in the state dir. */
  skipHosts: string[];
}

const hosts = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((h) => h.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean);

export function optsFromEnv(env: NodeJS.ProcessEnv = process.env): Opts {
  const list = (v: string | undefined, d: readonly string[]) =>
    (v ? v.split(",") : [...d]).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    countries: list(env.LINK_COUNTRIES, ACTIVE_COUNTRIES),
    movedCountries: list(env.LINK_MOVED_COUNTRIES, ["TR"]),
    budget: num(env.LINK_BUDGET, 3000),
    perHost: num(env.LINK_PER_HOST, 150),
    minPerHost: num(env.LINK_MIN_PER_HOST, 8),
    concurrency: num(env.LINK_CONCURRENCY, 16),
    perHostConcurrency: num(env.LINK_PER_HOST_CONCURRENCY, 2),
    gapMs: num(env.LINK_GAP_MS, 500),
    timeoutMs: num(env.LINK_TIMEOUT_MS, 20_000),
    dryRun: env.LINK_DRY_RUN === "1",
    onlyHosts: hosts(env.LINK_ONLY_HOSTS),
    skipHosts: hosts(env.LINK_SKIP_HOSTS),
  };
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Due = never checked, one strike pending, or older than the tier's interval. */
const DUE = (interval: string) => `(l.product_id IS NULL OR l.url <> c.url
   OR (l.strikes > 0 AND l.checked_at < now() - interval '45 minutes')
   OR (l.status = 'unknown' AND l.checked_at < now() - interval '1 day')
   OR l.checked_at < now() - interval '${interval}')`;

/** $1 text[] countries, $2 per-host cap, $3 batch size, $4 text[] hosts to skip, $5 text[] only these hosts (empty = all). */
export const CANDIDATES_SQL = `
  WITH tracked AS (
    SELECT product_id AS id FROM push_watch
    UNION SELECT product_id FROM user_watch
    UNION SELECT product_id FROM watchlist
  ),
  t1 AS (
    SELECT p.id, p.country, p.brand, p.url, 1 AS tier
      FROM tracked t JOIN products p ON p.id = t.id
      LEFT JOIN product_link_checks l ON l.product_id = p.id
      CROSS JOIN LATERAL (SELECT p.url) c(url)
     WHERE p.in_stock AND p.country = ANY($1::text[]) AND ${DUE("12 hours")}
  ),
  t2 AS (
    SELECT c.id, c.country, c.brand, c.url, 2 AS tier
      FROM feed_items c TABLESAMPLE SYSTEM (3)
      LEFT JOIN product_link_checks l ON l.product_id = c.id
     WHERE c.country = ANY($1::text[]) AND ${DUE("7 days")}
  ),
  t3 AS (
    SELECT c.id, c.country, c.brand, c.url, 3 AS tier
      FROM catalogue_items c TABLESAMPLE SYSTEM (1)
      LEFT JOIN product_link_checks l ON l.product_id = c.id
     WHERE c.country = ANY($1::text[]) AND c.in_stock AND ${DUE("30 days")}
  ),
  pending AS (
    SELECT p.id, p.country, p.brand, p.url, 0 AS tier
      FROM product_link_checks l JOIN products p ON p.id = l.product_id
      CROSS JOIN LATERAL (SELECT p.url) c(url)
     WHERE l.strikes > 0 AND NOT l.broken AND l.url = p.url AND p.in_stock
       AND p.country = ANY($1::text[]) AND l.checked_at < now() - interval '45 minutes'
  ),
  allc AS (
    SELECT DISTINCT ON (id) * FROM (SELECT * FROM pending UNION ALL SELECT * FROM t1
                                    UNION ALL SELECT * FROM t2 UNION ALL SELECT * FROM t3) u
     ORDER BY id, tier
  ),
  hosted AS (
    SELECT *, lower(regexp_replace(substring(url from '^https?://([^/:]+)'), '^www\\.', '')) AS host FROM allc
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY host ORDER BY tier, random()) AS rn
      FROM hosted WHERE host <> ALL($4::text[]) AND (cardinality($5::text[]) = 0 OR host = ANY($5::text[]))
  )
  SELECT id, country, brand, url, tier FROM ranked WHERE rn <= $2
   ORDER BY tier, random() LIMIT $3`;

/** A few random in-stock catalogue rows of each (country, brand), for the anomaly test. */
export const CONTROLS_SQL = `
  SELECT c.id, c.country, c.brand, c.url, 4 AS tier
    FROM unnest($1::text[], $2::text[], $3::int[]) AS d(country, brand, n)
    CROSS JOIN LATERAL (
      SELECT id, country, brand, url FROM catalogue_items x
       WHERE x.country = d.country AND x.brand = d.brand AND x.in_stock
       ORDER BY random() LIMIT d.n) c`;

/**
 * Throw away a shop's broken answers when they are most of what it said this
 * run (see the header). Pure, for tests. Returns the hosts that were voided.
 */
export function voidAnomalies(
  rows: { c: Candidate; r: LinkResult }[],
  minDecisive = 8,
  maxBrokenShare = 0.5,
): string[] {
  const by = new Map<string, { decisive: number; broken: number }>();
  for (const { c, r } of rows) {
    const h = hostOf(c.url);
    const s = by.get(h) ?? { decisive: 0, broken: 0 };
    if (r.verdict !== "unknown") s.decisive++;
    if (r.verdict === "gone" || r.verdict === "moved") s.broken++;
    by.set(h, s);
  }
  const voided = [...by].filter(([, s]) => s.decisive >= minDecisive && s.broken / s.decisive > maxBrokenShare).map(([h]) => h);
  for (const row of rows) {
    if (voided.includes(hostOf(row.c.url)) && (row.r.verdict === "gone" || row.r.verdict === "moved")) {
      row.r = { ...row.r, verdict: "unknown", note: "shop-wide anomaly" };
    }
  }
  return voided;
}

/** `moved` only counts where this vantage point is trusted (see the header). */
export function trustVerdict(c: Candidate, r: LinkResult, movedCountries: string[]): LinkResult {
  if (r.verdict === "moved" && !movedCountries.includes(c.country)) {
    return { ...r, verdict: "unknown", note: `moved, untrusted from here for ${c.country}` };
  }
  return r;
}

const REFUSED = (r: LinkResult) => r.verdict === "unknown" && (r.http === null || r.http === 403 || r.http === 429 || r.http === 418);

/**
 * Check every candidate, shop by shop: at most `perHostConcurrency` requests in
 * flight per shop and `concurrency` overall, `gapMs` between one worker's
 * requests. A shop whose first answers are all refusals is abandoned.
 */
export async function checkAll(
  cands: Candidate[],
  o: Opts,
  check: (url: string) => Promise<LinkResult> = (u) => checkLink(u, { timeoutMs: o.timeoutMs }),
): Promise<{ rows: { c: Candidate; r: LinkResult }[]; walled: string[] }> {
  const queues = new Map<string, Candidate[]>();
  for (const c of cands) {
    const h = hostOf(c.url);
    if (!queues.has(h)) queues.set(h, []);
    queues.get(h)!.push(c);
  }
  const rows: { c: Candidate; r: LinkResult }[] = [];
  const walled: string[] = [];
  let inFlight = 0;
  const waiters: (() => void)[] = [];
  const acquire = () =>
    inFlight < o.concurrency ? (inFlight++, Promise.resolve()) : new Promise<void>((r) => waiters.push(() => (inFlight++, r())));
  const release = () => {
    inFlight--;
    waiters.shift()?.();
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.all(
    [...queues].map(async ([host, q]) => {
      const seen: LinkResult[] = [];
      let stop = false;
      await Promise.all(
        Array.from({ length: Math.min(o.perHostConcurrency, q.length) }, async () => {
          for (let c = q.shift(); c && !stop; c = q.shift()) {
            await acquire();
            let r: LinkResult;
            try {
              r = await check(c.url);
            } finally {
              release();
            }
            rows.push({ c, r });
            seen.push(r);
            if (seen.length >= 4 && seen.every(REFUSED)) {
              stop = true;
              walled.push(host);
            }
            if (o.gapMs) await sleep(o.gapMs);
          }
        }),
      );
    }),
  );
  return { rows, walled };
}

/**
 * Record one batch. $1 int[] ids, $2 text[] urls, $3 text[] verdicts,
 * $4 int[] http, $5 text[] final urls. A broken verdict adds a strike (or
 * starts again at one when the url changed); `ok` clears everything;
 * `unknown` only stamps the time. Returns the ids whose `broken` flipped.
 */
export const RECORD_SQL = `
  WITH input AS (
    SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[], $5::text[])
      AS i(product_id, url, status, http, final_url)
  ),
  before AS (
    SELECT l.product_id, l.broken FROM product_link_checks l JOIN input i USING (product_id)
  ),
  up AS (
    INSERT INTO product_link_checks AS l (product_id, url, status, http, final_url, strikes, broken, broken_since, checked_at)
    SELECT product_id, url, status, http, final_url,
           CASE WHEN status IN ('gone', 'moved') THEN 1 ELSE 0 END, false,
           CASE WHEN status IN ('gone', 'moved') THEN now() END, now()
      FROM input
    ON CONFLICT (product_id) DO UPDATE SET
      strikes = CASE
        WHEN EXCLUDED.status = 'ok' THEN 0
        WHEN EXCLUDED.status = 'unknown' THEN CASE WHEN l.url = EXCLUDED.url THEN l.strikes ELSE 0 END
        WHEN l.url = EXCLUDED.url THEN l.strikes + 1
        ELSE 1 END,
      broken_since = CASE
        WHEN EXCLUDED.status = 'ok' THEN NULL
        WHEN EXCLUDED.status = 'unknown' THEN CASE WHEN l.url = EXCLUDED.url THEN l.broken_since END
        WHEN l.url = EXCLUDED.url AND l.strikes > 0 THEN l.broken_since
        ELSE now() END,
      broken = CASE
        WHEN EXCLUDED.status = 'ok' THEN false
        WHEN EXCLUDED.status = 'unknown' THEN l.url = EXCLUDED.url AND l.broken
        ELSE l.url = EXCLUDED.url AND l.strikes + 1 >= 2 AND l.broken_since <= now() - interval '45 minutes' END,
      url = EXCLUDED.url,
      status = EXCLUDED.status,
      http = EXCLUDED.http,
      final_url = EXCLUDED.final_url,
      checked_at = now()
    RETURNING l.product_id, l.broken
  )
  SELECT up.product_id AS id FROM up LEFT JOIN before b USING (product_id)
   WHERE up.broken IS DISTINCT FROM COALESCE(b.broken, false)`;

export async function runOnce(
  db: Db,
  o: Opts,
  log: (s: string) => void = console.log,
  skipHosts: string[] = [],
): Promise<{ checked: number; flipped: number[]; walled: string[] }> {
  const t0 = Date.now();
  skipHosts = [...new Set([...skipHosts, ...o.skipHosts])];
  const cands = await db.query<Candidate>(CANDIDATES_SQL, [o.countries, o.perHost, o.budget, skipHosts, o.onlyHosts]);
  if (skipHosts.length) log(`links: skipping ${skipHosts.length} shops that refused this box in the last 24 h`);
  // Top up shops that have too few rows in this batch to judge an anomaly.
  const per = new Map<string, { c: Candidate; n: number }>();
  for (const c of cands) {
    const k = `${c.country}|${c.brand}`;
    const e = per.get(k) ?? { c, n: 0 };
    e.n++;
    per.set(k, e);
  }
  const short = [...per.values()].filter((e) => e.n < o.minPerHost);
  let controls: Candidate[] = [];
  if (short.length) {
    controls = await db.query<Candidate>(CONTROLS_SQL, [
      short.map((e) => e.c.country), short.map((e) => e.c.brand), short.map((e) => o.minPerHost - e.n),
    ]);
  }
  const ids = new Set(cands.map((c) => c.id));
  const all = [...cands, ...controls.filter((c) => !ids.has(c.id))];
  log(`links: ${cands.length} due + ${all.length - cands.length} controls across ${new Set(all.map((c) => hostOf(c.url))).size} shops`);

  const { rows, walled } = await checkAll(all, o);
  for (const row of rows) row.r = trustVerdict(row.c, row.r, o.movedCountries);
  const voided = voidAnomalies(rows, o.minPerHost);

  // Per-shop summary, then the broken ones in full so the log is the audit trail.
  const sum = new Map<string, Record<string, number>>();
  for (const { c, r } of rows) {
    const k = `${c.country} ${c.brand}`;
    const s = sum.get(k) ?? {};
    s[r.verdict] = (s[r.verdict] ?? 0) + 1;
    sum.set(k, s);
  }
  for (const [k, s] of [...sum].sort()) log(`  ${k}: ${Object.entries(s).map(([v, n]) => `${v} ${n}`).join(", ")}`);
  if (walled.length) log(`  refused (skipped after 4): ${walled.sort().join(", ")}`);
  if (voided.length) log(`  shop-wide anomaly (broken answers ignored): ${voided.sort().join(", ")}`);
  for (const { c, r } of rows) {
    if (r.verdict === "gone" || r.verdict === "moved") log(`  ${r.verdict} ${r.http} #${c.id} ${c.country}/${c.brand} ${c.url} -> ${r.finalUrl}`);
  }

  if (o.dryRun) {
    log(`links: dry run, nothing written (${Math.round((Date.now() - t0) / 1000)} s)`);
    return { checked: rows.length, flipped: [], walled };
  }
  const flipped: number[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const out = await db.query<{ id: number }>(RECORD_SQL, [
      chunk.map((x) => x.c.id),
      chunk.map((x) => x.c.url),
      chunk.map((x) => x.r.verdict),
      chunk.map((x) => x.r.http),
      chunk.map((x) => x.r.finalUrl),
    ]);
    flipped.push(...out.map((o) => Number(o.id)));
  }
  if (flipped.length) await refreshFeedItems(db, flipped);
  const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM product_link_checks WHERE broken`);
  log(`links: checked ${rows.length}, ${flipped.length} hidden/un-hidden, ${n} hidden in total (${Math.round((Date.now() - t0) / 1000)} s)`);
  return { checked: rows.length, flipped, walled };
}

/**
 * Shops that refused this box, remembered for a day in the state dir so their
 * rows stop taking the batch's budget (most Turkish shops 403 a Hetzner IP —
 * Inditex, H&M, Boyner, DeFacto…). Best-effort: no state dir, no memory.
 */
export const WALL_TTL_MS = 24 * 3600_000;
function wallFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.MODADROP_STATE_DIR ?? "/var/lib/modadrop", "links-walled.json");
}
export function readWalls(now = Date.now(), file = wallFile()): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => now - t < WALL_TTL_MS));
  } catch {
    return {};
  }
}
function writeWalls(w: Record<string, number>, file = wallFile()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(w, null, 1));
  } catch {
    /* memory is an optimisation */
  }
}

async function main(): Promise<number> {
  const o = optsFromEnv();
  const walls = readWalls();
  const db = await connect();
  try {
    const { walled } = await runOnce(db, o, console.log, Object.keys(walls));
    const now = Date.now();
    for (const h of walled) walls[h] = now;
    if (!o.dryRun) writeWalls(walls);
    return 0;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("links: failed:", err instanceof Error ? err.stack : err);
      process.exit(1);
    },
  );
}
