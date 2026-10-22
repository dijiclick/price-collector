/**
 * The daily brand QA (2026-10-22). Owner: "every brand could crash or not work
 * correctly — we need a checker that runs once a day, reports bugs, and gets
 * them fixed". The crawler watchdog (lib/collector-health.ts) catches crashes
 * and empty runs; this catches the DATA bugs a manual QA found on 2026-10-21:
 * links that open a category or a 404, photos that 404, our price ≠ the shop's,
 * "was" prices the shop never showed, stale deals, an empty brand page.
 *
 *   tsx packages/collector/src/quality/run.ts             # one pass, writes brand_qa
 *   QA_DRY_RUN=1 QA_BRANDS=zara QA_COUNTRIES=TR … run.ts  # check + log, write nothing
 *   QA_REPLAY=1 … run.ts                                  # write the last run's saved results again
 *
 * For every brand × launched market in lib/brands.ts: QA_PER (5) random
 * in-stock deals from feed_items are checked against the shop (check.ts), and
 * the app's own brand page (/api/deals?brand=) is asked whether it shows
 * anything. rules.ts turns that into ok / warn / bad with reasons; one row per
 * pair per day goes into brand_qa (30 days kept), served by
 * /api/health/quality for the fixer.
 *
 * Runs on the main box as modadrop-quality.timer (03:30 UTC). The box is in
 * Germany: shops that wall it come out "blocked", never bad. Polite: at most
 * QA_PER_HOST requests in flight per shop, QA_GAP_MS apart, and a shop whose
 * first 4 answers are all walls is not asked again this run. A deadline
 * (QA_DEADLINE_MIN) keeps the run inside its systemd timeout; samples not
 * reached by then are recorded as unknown.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, type Db } from "../db";
import { politeMap } from "../link-check";
import { BRANDS } from "../../../../lib/brands";
import { ACTIVE_COUNTRIES } from "../../../../lib/countries";
import { checkApp, checkSample, type Sample } from "./check";
import { judgePair, type AppCheck, type SampleResult, type Verdict } from "./rules";

export interface Opts {
  countries: string[];
  brands: string[];
  per: number;
  concurrency: number;
  perHost: number;
  gapMs: number;
  timeoutMs: number;
  deadlineMin: number;
  api: string;
  dryRun: boolean;
  stateDir: string;
  /** Markets whose price mismatches count as proof (rules.ts `priceTrusted`). */
  priceTrusted: string[];
}

export function optsFromEnv(env: NodeJS.ProcessEnv = process.env): Opts {
  const list = (v: string | undefined, d: readonly string[], up = true) =>
    (v ? v.split(",") : [...d]).map((s) => (up ? s.trim().toUpperCase() : s.trim().toLowerCase())).filter(Boolean);
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    countries: list(env.QA_COUNTRIES, ACTIVE_COUNTRIES),
    brands: list(env.QA_BRANDS, [], false),
    per: num(env.QA_PER, 5),
    concurrency: num(env.QA_CONCURRENCY, 20),
    perHost: num(env.QA_PER_HOST, 2),
    gapMs: num(env.QA_GAP_MS, 500),
    timeoutMs: num(env.QA_TIMEOUT_MS, 20_000),
    deadlineMin: num(env.QA_DEADLINE_MIN, 38),
    api: (env.QA_API ?? "https://modadrop.vercel.app").replace(/\/$/, ""),
    dryRun: env.QA_DRY_RUN === "1",
    stateDir: env.MODADROP_STATE_DIR ?? "/var/lib/modadrop",
    // The box is in Germany: DE prices are local; Turkish shops either wall it
    // or answer with their one Turkish price.
    priceTrusted: list(env.QA_PRICE_TRUSTED, ["TR", "DE"]),
  };
}

/** Every (country, brand) pair lib/brands.ts says we serve, within the options. */
export function pairsFor(o: Pick<Opts, "countries" | "brands">): { country: string; brand: string }[] {
  const out: { country: string; brand: string }[] = [];
  for (const b of BRANDS) {
    if (o.brands.length && !o.brands.includes(b.slug)) continue;
    for (const c of b.countries) if (o.countries.includes(c)) out.push({ country: c, brand: b.slug });
  }
  return out;
}

/** In-stock deals per pair. $1 text[] countries. */
export const COUNTS_SQL = `
  SELECT country, brand, count(*)::int AS n FROM feed_items
   WHERE in_stock AND country = ANY($1::text[]) GROUP BY country, brand`;

/** $1 text[] countries, $2 text[] brands (pairwise), $3 per pair. */
export const SAMPLE_SQL = `
  SELECT d.country, d.brand, f.id, f.name, f.url, f.image_url, f.current_price AS price,
         f.current_list_price AS list, f.currency, f.last_seen
    FROM unnest($1::text[], $2::text[]) AS d(country, brand)
    CROSS JOIN LATERAL (
      SELECT id, name, url, image_url, current_price, current_list_price, currency, last_seen
        FROM feed_items x
       WHERE x.country = d.country AND x.brand = d.brand AND x.in_stock
       ORDER BY random() LIMIT $3) f`;

/**
 * One row per pair per day; a re-run the same day replaces it.
 * $1 date, then per row: $2 brand, $3 country, $4 sampled, $5 link_bad,
 * $6 img_bad, $7 price_mismatch, $8 fake_discount, $9 blocked, $10 app_empty,
 * $11 stale, $12 app_items, $13 db_deals, $14 samples (json text),
 * $15 reasons (newline-joined), $16 verdict.
 */
export const WRITE_SQL = `
  INSERT INTO brand_qa (day, brand, country, sampled, link_bad, img_bad, price_mismatch, fake_discount,
                        blocked, app_empty, stale, app_items, db_deals, samples, reasons, verdict, checked_at)
  SELECT $1::date, brand, country, sampled, link_bad, img_bad, price_mismatch, fake_discount,
         blocked, app_empty <> 0, stale, app_items, db_deals, samples::jsonb,
         CASE WHEN reasons = '' THEN '{}'::text[] ELSE string_to_array(reasons, E'\\n') END, verdict, now()
    FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[],
                $10::int[], $11::int[], $12::int[], $13::int[], $14::text[], $15::text[], $16::text[])
      AS i(brand, country, sampled, link_bad, img_bad, price_mismatch, fake_discount, blocked,
           app_empty, stale, app_items, db_deals, samples, reasons, verdict)
  ON CONFLICT (day, brand, country) DO UPDATE SET
    sampled = EXCLUDED.sampled, link_bad = EXCLUDED.link_bad, img_bad = EXCLUDED.img_bad,
    price_mismatch = EXCLUDED.price_mismatch, fake_discount = EXCLUDED.fake_discount,
    blocked = EXCLUDED.blocked, app_empty = EXCLUDED.app_empty, stale = EXCLUDED.stale,
    app_items = EXCLUDED.app_items, db_deals = EXCLUDED.db_deals, samples = EXCLUDED.samples,
    reasons = EXCLUDED.reasons, verdict = EXCLUDED.verdict, checked_at = EXCLUDED.checked_at`;

export const RETENTION_SQL = `DELETE FROM brand_qa WHERE day < (now() AT TIME ZONE 'UTC')::date - 30`;

export interface PairResult {
  country: string;
  brand: string;
  dbDeals: number;
  app: AppCheck | null;
  samples: SampleResult[];
  verdict: Verdict;
  reasons: string[];
  counts: ReturnType<typeof judgePair>["counts"];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A sample nobody fetched (deadline, or a shop that walled us), recorded as unknown. */
function unchecked(s: Sample, why: string, blocked: boolean, now: number): SampleResult {
  const seen = new Date(s.last_seen).getTime();
  return {
    id: s.id, name: s.name, url: s.url, image: s.image_url, price: s.price, list: s.list, currency: s.currency,
    lastSeen: new Date(seen).toISOString(), link: blocked ? "blocked" : "unknown", linkNote: why,
    img: "unknown", priceCheck: "unknown", priceNote: why, fake: false, stale: now - seen > 24 * 3_600_000,
  };
}

export async function runOnce(
  db: Db,
  o: Opts,
  log: (s: string) => void = console.log,
  deps: {
    check?: (s: Sample) => Promise<SampleResult>;
    app?: (country: string, brand: string) => Promise<AppCheck>;
    now?: () => number;
  } = {},
): Promise<PairResult[]> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const deadline = t0 + o.deadlineMin * 60_000;
  const check = deps.check ?? ((s: Sample) => checkSample(s, { timeoutMs: o.timeoutMs }));
  const app = deps.app ?? ((c: string, b: string) => checkApp(o.api, c, b));

  const pairs = pairsFor(o);
  const counts = new Map(
    (await db.query<{ country: string; brand: string; n: number }>(COUNTS_SQL, [o.countries])).map((r) => [`${r.country}|${r.brand}`, Number(r.n)]),
  );
  const withDeals = pairs.filter((p) => (counts.get(`${p.country}|${p.brand}`) ?? 0) > 0);
  const samples = withDeals.length
    ? await db.query<Sample & { country: string; brand: string }>(SAMPLE_SQL, [
        withDeals.map((p) => p.country), withDeals.map((p) => p.brand), o.per,
      ])
    : [];
  for (const s of samples) {
    s.price = Number(s.price);
    s.list = s.list === null ? null : Number(s.list);
  }
  log(`quality: ${pairs.length} pairs, ${withDeals.length} with deals, ${samples.length} samples across ${new Set(samples.map((s) => hostOf(s.url))).size} shops`);

  // Shops that wall this box: after 4 answers that are all walls, skip the rest.
  const walls = new Map<string, { seen: number; walled: number }>();
  const [results, apps] = await Promise.all([
    politeMap(
      samples,
      (s) => hostOf(s.url),
      async (s): Promise<SampleResult> => {
        if (now() > deadline) return unchecked(s, "not reached before the deadline", false, now());
        const h = hostOf(s.url);
        const w = walls.get(h) ?? { seen: 0, walled: 0 };
        if (w.seen >= 4 && w.walled === w.seen) return unchecked(s, "shop walls this box (skipped)", true, now());
        const r = await check(s);
        w.seen++;
        if (r.link === "blocked") w.walled++;
        walls.set(h, w);
        return r;
      },
      { perKey: o.perHost, total: o.concurrency, gapMs: o.gapMs },
    ),
    // The app's API is one host: three at a time, a short gap.
    politeMap(withDeals, () => "api", (p) => (now() > deadline ? Promise.resolve(null) : app(p.country, p.brand)), {
      perKey: 3, total: 3, gapMs: 150,
    }),
  ]);

  const byPair = new Map<string, SampleResult[]>();
  samples.forEach((s, i) => {
    const k = `${s.country}|${s.brand}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k)!.push(results[i]);
  });
  const appBy = new Map(withDeals.map((p, i) => [`${p.country}|${p.brand}`, apps[i]]));
  const out: PairResult[] = pairs.map((p) => {
    const k = `${p.country}|${p.brand}`;
    const dbDeals = counts.get(k) ?? 0;
    const ss = byPair.get(k) ?? [];
    const a = appBy.get(k) ?? null;
    const j = judgePair(ss, a, dbDeals, { priceTrusted: o.priceTrusted.includes(p.country) });
    return { ...p, dbDeals, app: a, samples: ss, verdict: j.verdict, reasons: j.reasons, counts: j.counts };
  });

  const tally = out.reduce<Record<string, number>>((t, r) => ((t[r.verdict] = (t[r.verdict] ?? 0) + 1), t), {});
  log(`quality: ${Object.entries(tally).map(([v, n]) => `${v} ${n}`).join(", ")} (${Math.round((now() - t0) / 1000)} s)`);
  for (const v of ["bad", "warn"] as const) {
    for (const r of out.filter((x) => x.verdict === v)) log(`  ${v} ${r.country} ${r.brand}: ${r.reasons.join("; ")}`);
  }

  const day = new Date(t0).toISOString().slice(0, 10);
  // Kept on disk so a failed write is redone with QA_REPLAY=1, not a 30-min re-run.
  try {
    mkdirSync(o.stateDir, { recursive: true });
    writeFileSync(join(o.stateDir, "quality-last.json"), JSON.stringify({ day, out }));
  } catch {
    /* best-effort */
  }
  if (o.dryRun) {
    log("quality: dry run, nothing written");
    return out;
  }
  await writeResults(db, day, out);
  log(`quality: wrote ${out.length} rows for ${day}`);
  return out;
}

export async function writeResults(db: Db, day: string, out: PairResult[]): Promise<void> {
  for (let i = 0; i < out.length; i += 300) {
    const c = out.slice(i, i + 300);
    await db.query(WRITE_SQL, [
      day,
      c.map((r) => r.brand), c.map((r) => r.country), c.map((r) => r.counts.sampled), c.map((r) => r.counts.link_bad),
      c.map((r) => r.counts.img_bad), c.map((r) => r.counts.price_mismatch), c.map((r) => r.counts.fake_discount),
      // As 0/1: postgres.js cannot send a boolean[] parameter.
      c.map((r) => r.counts.blocked), c.map((r) => (r.counts.app_empty ? 1 : 0)), c.map((r) => r.counts.stale),
      c.map((r) => r.app?.items ?? null), c.map((r) => r.dbDeals),
      c.map((r) => JSON.stringify(r.samples)),
      c.map((r) => r.reasons.join("\n")), c.map((r) => r.verdict),
    ]);
  }
  await db.query(RETENTION_SQL);
}

async function main(): Promise<number> {
  const o = optsFromEnv();
  const db = await connect();
  try {
    if (process.env.QA_REPLAY === "1") {
      const { day, out } = JSON.parse(readFileSync(join(o.stateDir, "quality-last.json"), "utf8")) as { day: string; out: PairResult[] };
      await writeResults(db, day, out);
      console.log(`quality: replayed ${out.length} rows for ${day}`);
      return 0;
    }
    await runOnce(db, o);
    return 0;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("quality: failed:", err instanceof Error ? err.stack : err);
      process.exit(1);
    },
  );
}
