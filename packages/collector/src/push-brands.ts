/**
 * The daily followed-brand alert (owner, 2026-11-07: "daily users come to our
 * app to check their favourite brands … new collection added, new deals added,
 * and it goes to that page").
 *
 * Rules agreed with Codex (scratchpad brief, 11-07), kept deliberately plain:
 *   - A device's favourite brands are the ones it ticked in Markalarım (synced
 *     as prefs.brands; following every brand is the default and sends none)
 *     plus the brands of what it tracks. Nobody else gets this push.
 *   - One brand per push, the strongest real signal of the last 24 h:
 *       sale   a sale started (brand-sales.ts),
 *       deals  5+ in-stock products newly down 10%+ (the device's own minimum
 *              if higher), on products we already knew,
 *       new    10+ genuinely new in-stock products on an established brand
 *              (on it 14+ days), and not a catalogue backfill (under 20% of
 *              what is in stock). Said as "new arrivals", never "collection":
 *              we cannot tell a launch from a restock of the range.
 *     Nothing qualifies → nothing is sent. No filler.
 *   - At most one a day, 20:30-21:59 local (the round-up's window), never on
 *     an evening that already had a nudge, quiet hours and the news switch
 *     respected. Back-off on its own opens: 3 ignored in a row → every 48 h,
 *     6 → weekly, 8 → monthly; an open starts the count again.
 *   - It is logged as a nudge, so the 48 h round-up and the first-week series
 *     step aside after it: it replaces them for these devices rather than
 *     stacking on top.
 *   - The tap opens the brand's live deals: Yeni for that brand and window
 *     (deals, sale), or Fırsatlar on that brand, newest first, full price in
 *     (new arrivals).
 */
import type { Db } from "./db";
import { devicePrefs } from "./push";
import type { PushContent } from "./push-transport";
import { BRAND_LABELS, nf } from "../../../lib/format";
import { copyLang, serverCopy } from "./i18n/server";
import { logPushes } from "./push-log";
import { localDate, newsAwake, realNewsSend, yeniHref, type NewsDevice, type NewsSend } from "./push-news";

export const DEAL_MIN = 5;
export const DEAL_PCT = 10;
export const NEW_MIN = 10;
/** A brand this young is still being collected for the first time. */
const ESTABLISHED_DAYS = 14;
/** More new rows than this share of the in-stock catalogue is a backfill, not arrivals. */
const BACKFILL_SHARE = 0.2;

export type BrandSignal =
  | { kind: "sale"; brand: string; n: number; pct: number }
  | { kind: "deals"; brand: string; n: number; pct: number }
  | { kind: "new"; brand: string; n: number };

export interface BrandFacts {
  /** brand → { n, pct }: in-stock products newly down at least `pct` (their smallest cut) in 24 h. */
  deals: Map<string, { n: number; pct: number }>;
  /** brand → genuinely new in-stock products in 24 h. */
  arrivals: Map<string, number>;
  /** Brands whose sale started in the last 24 h. */
  sales: Set<string>;
}

/**
 * The one brand and signal worth a push, or null. Sale beats deals beats new
 * arrivals; within a kind the bigger number wins, and a brand that had a brand
 * push in the last 48 h only wins when no other brand qualifies.
 */
export function pickSignal(brands: string[], facts: BrandFacts, minPct: number, recent: Set<string>): BrandSignal | null {
  const order = (a: { brand: string; n: number }, b: { brand: string; n: number }) =>
    Number(recent.has(a.brand)) - Number(recent.has(b.brand)) || b.n - a.n || a.brand.localeCompare(b.brand);
  const sale = brands.filter((b) => facts.sales.has(b)).map((b) => ({ brand: b, n: facts.deals.get(b)?.n ?? 0, pct: facts.deals.get(b)?.pct ?? DEAL_PCT }));
  if (sale.length) { const s = sale.sort(order)[0]; return { kind: "sale", ...s }; }
  const deals = brands
    .map((b) => ({ brand: b, ...(facts.deals.get(b) ?? { n: 0, pct: 0 }) }))
    .filter((d) => d.n >= DEAL_MIN && d.pct >= Math.max(DEAL_PCT, minPct));
  if (deals.length) { const d = deals.sort(order)[0]; return { kind: "deals", ...d }; }
  const fresh = brands.map((b) => ({ brand: b, n: facts.arrivals.get(b) ?? 0 })).filter((x) => x.n >= NEW_MIN);
  if (fresh.length) { const f = fresh.sort(order)[0]; return { kind: "new", brand: f.brand, n: f.n }; }
  return null;
}

/**
 * Codex's back-off, on this push's own record: `streak` brand pushes in a row
 * unopened. 0-2 → daily (20 h, so the same evening slot works every day),
 * 3-5 → 48 h, 6-7 → a week, 8+ → 30 days. An open resets the streak.
 */
export function brandGapMs(streak: number): number {
  const h = streak >= 8 ? 30 * 24 : streak >= 6 ? 7 * 24 : streak >= 3 ? 48 : 20;
  return h * 3600_000;
}

/** A stable choice of template for this device, brand and day, so wording varies across days. */
export function variant(len: number, seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return len ? h % len : 0;
}

export function buildBrandAlert(lang: string | null, s: BrandSignal, seed: string): { title: string; body: string } {
  const c = serverCopy(lang).brandAlert;
  const name = BRAND_LABELS[s.brand] ?? s.brand;
  const n = nf(s.n, copyLang(lang));
  if (s.kind === "new") return pick(c.arrivals, seed)(name, n);
  const list = s.kind === "sale" ? c.sale : c.deals;
  return pick(list, seed)(name, n, String(s.pct));
}
function pick<T>(list: readonly T[], seed: string): T {
  return list[variant(list.length, seed)];
}

/** Where the tap lands: the brand's live deals, or its newest pieces for arrivals. */
export function brandHref(s: BrandSignal, now: Date): string {
  if (s.kind === "new") return `/firsatlar?brand=${encodeURIComponent(s.brand)}&sort=new&all=1`;
  return yeniHref(new Date(now.getTime() - 24 * 3600_000), [s.brand]);
}

/** The day's facts for one market, read once per run per country. */
async function factsFor(db: Db, country: string, now: Date): Promise<BrandFacts> {
  const at = now.toISOString();
  const deals = await db.query<{ brand: string; n: number; pct: number }>(
    `SELECT brand, count(*)::int AS n, min(pct)::int AS pct FROM (
       SELECT p.id, p.brand, max(abs(e.pct)) AS pct
         FROM events e JOIN products p ON p.id = e.product_id
        WHERE e.type = 'price_drop' AND e.ts > $1::timestamptz - interval '24 hours' AND e.ts <= $1::timestamptz
          AND abs(e.pct) >= $3 AND p.in_stock AND p.country = $2
          AND p.first_seen <= $1::timestamptz - interval '24 hours'
        GROUP BY p.id, p.brand) x
      GROUP BY brand`,
    [at, country, DEAL_PCT],
  );
  const arrivals = await db.query<{ brand: string; n: number }>(
    `WITH fresh AS (
       SELECT brand, count(*)::int AS n FROM products
        WHERE country = $2 AND in_stock AND first_seen > $1::timestamptz - interval '24 hours' AND first_seen <= $1::timestamptz
        GROUP BY brand HAVING count(*) >= ${NEW_MIN})
     SELECT f.brand, f.n FROM fresh f
      WHERE EXISTS (SELECT 1 FROM products o WHERE o.brand = f.brand AND o.country = $2
                     AND o.first_seen <= $1::timestamptz - interval '${ESTABLISHED_DAYS} days')
        AND f.n <= ${BACKFILL_SHARE} * (SELECT count(*) FROM products s WHERE s.brand = f.brand AND s.country = $2 AND s.in_stock)`,
    [at, country],
  );
  const sales = await db.query<{ brand: string }>(
    `SELECT brand FROM brand_sales WHERE country = $2 AND started_at > $1::timestamptz - interval '24 hours' AND started_at <= $1::timestamptz`,
    [at, country],
  );
  return {
    deals: new Map(deals.map((r) => [r.brand, { n: r.n, pct: r.pct }])),
    arrivals: new Map(arrivals.map((r) => [r.brand, r.n])),
    sales: new Set(sales.map((r) => r.brand)),
  };
}

interface Row {
  token: string; lang: string | null; tz: string | null; prefs: unknown; storefront: string | null;
  tracked: string[] | null; tracked_country: string | null;
  last_nudge: Date | string | null;
  /** The device's brand pushes, newest first: when, which brand, opened or not. */
  history: { at: string; brand: string; opened: boolean }[] | null;
}

const asDate = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v : new Date(v));

export async function pushBrands(db: Db, opts: { now?: Date; send?: NewsSend } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? realNewsSend;
  const rows = await db.query<Row>(
    `SELECT d.token, d.lang, d.tz, d.prefs, d.storefront,
            (SELECT array_agg(DISTINCT p.brand) FROM push_watch w JOIN products p ON p.id = w.product_id WHERE w.token = d.token) AS tracked,
            (SELECT min(p.country) FROM push_watch w JOIN products p ON p.id = w.product_id WHERE w.token = d.token) AS tracked_country,
            GREATEST((SELECT max(sent_at) FROM push_log l WHERE l.token = d.token AND l.nudge),
                     (SELECT max(sent_at) FROM push_news n WHERE n.token = d.token)) AS last_nudge,
            (SELECT json_agg(json_build_object('at', l.sent_at, 'brand', split_part(l.key, ':', 3), 'opened', l.opened_at IS NOT NULL) ORDER BY l.sent_at DESC)
               FROM (SELECT * FROM push_log l WHERE l.token = d.token AND l.kind = 'brand' ORDER BY sent_at DESC LIMIT 10) l) AS history
       FROM push_devices d
      WHERE (d.prefs ? 'brands') OR EXISTS (SELECT 1 FROM push_watch w WHERE w.token = d.token)`,
  );
  const facts = new Map<string, Promise<BrandFacts>>();
  const factsOnce = (country: string) => {
    if (!facts.has(country)) facts.set(country, factsFor(db, country, now));
    return facts.get(country)!;
  };
  let sent = 0;
  for (const r of rows) {
    const prefs = devicePrefs(r.prefs);
    const favourites = [...new Set([...(prefs?.brands ?? []), ...(r.tracked ?? [])])];
    const country = prefs?.country ?? r.tracked_country ?? r.storefront;
    if (!favourites.length || !country) continue;
    const dev: NewsDevice = { token: r.token, lang: r.lang, tz: r.tz, prefs: r.prefs, last_news: null, brands: favourites, country };
    if (!newsAwake(dev, now)) continue;
    // Never two nudges on one evening, whichever kind came first.
    const last = asDate(r.last_nudge);
    if (last && now.getTime() - last.getTime() < 12 * 3600_000) continue;
    const history = (r.history ?? []).map((h) => ({ ...h, at: new Date(h.at) }));
    let streak = 0;
    for (const h of history) { if (h.opened) break; streak++; }
    if (history[0] && now.getTime() - history[0].at.getTime() < brandGapMs(streak)) continue;
    const recent = new Set(history.filter((h) => now.getTime() - h.at.getTime() < 48 * 3600_000).map((h) => h.brand));
    const signal = pickSignal(favourites, await factsOnce(country), prefs?.minPct ?? 0, recent);
    if (!signal) continue;
    const day = localDate(r.tz, now);
    const key = `brand:${signal.kind}:${signal.brand}:${day}`;
    const m = buildBrandAlert(r.lang, signal, `${r.token}:${day}`);
    const out = await send(r.token, { title: m.title, body: m.body, kind: "news", href: brandHref(signal, now) });
    if (out !== "ok") continue;
    sent++;
    await db.query(`INSERT INTO push_news (token, key, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [r.token, key, now.toISOString()]);
    await logPushes(db, [{ token: r.token, kind: "brand", nudge: true, key }], now);
  }
  if (sent) console.log(`brand alerts: ${sent} sent`);
  return sent;
}
