/**
 * The one push a day (owner, 2026-11-08: "every day once a day, with sound";
 * 11-07: "daily users come to our app to check their favourite brands").
 *
 * Every device with news on gets one product a day, in the evening on its own
 * clock, with sound, and the tap opens that product. Nothing else unasked goes
 * out the same day: a sale start, a calendar eve or a remembered search counts
 * as the day's one. A device's own drops, targets and sizes are not nudges.
 *
 * Which product, first that applies:
 *   - a sale that started in the last 24 h on a brand the device follows or tracks,
 *   - else 5+ products of such a brand newly down 10%+ (its deepest one), or 10+
 *     new products on an established brand,
 *   - else the deepest cut among those brands,
 *   - else a pick from the market's household names (Zara, Mango, H&M…), so someone who
 *     tracks nothing hears from us too: 75 of 163 devices heard nothing in 14 days.
 *
 * The price rule (owner + Codex, 2026-11-08): at least 20% off, not fine jewellery
 * or anything but clothes, shoes and bags, and small: at or under the market's median price for such a product, up to its 75th
 * percentile if nothing is. AED 11,000 of diamonds must never headline a push. The
 * same product twice in 30 days is skipped. A day with nothing qualifying sends nothing.
 *
 * Text: Codex's review of 11-08, one real product and its two prices, no count and
 * no urgency we cannot prove ("new arrivals", never "collection": we cannot tell a
 * launch from a restock).
 */
import type { Db } from "./db";
import { devicePrefs, inQuietHours, localMinutes, pushMoney, pushName } from "./push";
import { classifyToken, hasCoinChannel, type PushContent } from "./push-transport";
import { fromMinor } from "./normalize";
import { BRAND_LABELS } from "../../../lib/format";
import { householdNames } from "../../../lib/brand-weight";
import type { CountryCode } from "../../../lib/countries";
import { serverCopy } from "./i18n/server";
import { logPushes, NUDGE_GAP_MS } from "./push-log";
import { localDate, NEWS_DEFAULT_TZ, realNewsSend, type NewsSend } from "./push-news";

export const DEAL_MIN = 5;
export const DEAL_PCT = 10;
export const NEW_MIN = 10;
/** The pick's own floor: the owner's "at least 20% off". */
export const HERO_PCT = 20;
/** A brand this young is still being collected for the first time. */
const ESTABLISHED_DAYS = 14;
/** More new rows than this share of the in-stock catalogue is a backfill, not arrivals. */
const BACKFILL_SHARE = 0.2;
/** 19:00-21:59 on the device's clock. It was 20:30: the collector's runs are ~2 h apart, so 90 minutes missed whole evenings (11-06). */
const WINDOW_FROM = 19 * 60;
const WINDOW_TO = 22 * 60;
const REPEAT_DAYS = 30;
const TYPES = ["ust", "alt", "elbise", "dis-giyim", "triko", "ayakkabi", "canta"];
const REAL_CUT = 70;
/** Beauty shops: their rows carry clothing shelves now and then (a hair-roller set as "ust"), and the pick is clothes, shoes and bags. */
const BEAUTY = ["sephora", "gratis", "rossmann", "watsons", "goldenscent", "ulta", "boots", "douglas", "nahdi", "primor", "druni"];
/**
 * Not picked for someone who did not choose them: department stores and resellers,
 * whose rows are other people's brands, some of them nobody's idea of a good brand.
 * The owner: "from good brands". Followed, they are the shopper's own choice.
 */
const NOT_A_PICK = new Set(["boyner", "beymen", "fashfed", "flo", "vakkorama", "instreet", "superstep", "sneaksup", "nordstrom", "nordstromrack", "macys", "kohls", "bloomingdales", "ounass", "styli", "centrepoint", "maxfashion", "zalando", "aboutyou", "asos", "theiconic", "elcorteingles", "next"]);

export type BrandSignal = { kind: "sale" | "deals" | "new"; brand: string; n: number };

export interface BrandFacts {
  /** brand → products newly down at least DEAL_PCT in 24 h. */
  deals: Map<string, number>;
  /** brand → genuinely new in-stock products in 24 h. */
  arrivals: Map<string, number>;
  /** Brands whose sale started in the last 24 h. */
  sales: Set<string>;
}

export interface Hero {
  id: number; brand: string; name: string; price: number; was: number | null; pct: number;
  currency: string | null; image: string | null; gender: string | null;
  /** At or under the market's median, the first choice. */
  small: boolean;
}

/** The brand with news, or null: sale, then deals, then new; a brand pushed in the last 48 h only when none other has any. Pure. */
export function pickSignal(brands: string[], facts: BrandFacts, recent: Set<string>): BrandSignal | null {
  const best = (kind: BrandSignal["kind"], n: (b: string) => number, ok: (n: number) => boolean) => {
    const list = brands.map((b) => ({ kind, brand: b, n: n(b) })).filter((x) => ok(x.n));
    return list.sort((a, b) => Number(recent.has(a.brand)) - Number(recent.has(b.brand)) || b.n - a.n || a.brand.localeCompare(b.brand))[0] ?? null;
  };
  return best("sale", (b) => (facts.sales.has(b) ? 1 : 0), (n) => n > 0)
    ?? best("deals", (b) => facts.deals.get(b) ?? 0, (n) => n >= DEAL_MIN)
    ?? best("new", (b) => facts.arrivals.get(b) ?? 0, (n) => n >= NEW_MIN);
}

/** A stable choice for this device and day, so two people or two days differ. */
export function variant(len: number, seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return len ? h % len : 0;
}

/**
 * One product: small prices first, a brand chosen per device and day so people and
 * days differ, then among that brand's best few. A cut past REAL_CUT only if the
 * brand has nothing else: −85% on a ₺1,199 "list price" is how the first run picked
 * outlet dresses for everyone. Pure.
 */
export function chooseHero(list: Hero[], seed: string): Hero | null {
  const pool = list.some((h) => h.small) ? list.filter((h) => h.small) : list;
  const brands = [...new Set(pool.map((h) => h.brand))].sort();
  if (!brands.length) return null;
  const brand = brands[variant(brands.length, seed)];
  const mine = pool.filter((h) => h.brand === brand);
  const real = mine.filter((h) => h.pct <= REAL_CUT);
  const top = (real.length ? real : mine).slice(0, 6);
  return top[variant(top.length, `${seed}:item`)] ?? null;
}

export function buildDailyPush(lang: string | null, why: "sale" | "deals" | "new" | "followed" | "pick", h: Hero): { title: string; body: string } {
  const copy = serverCopy(lang);
  const c = copy.daily;
  const label = BRAND_LABELS[h.brand] ?? h.brand;
  const money = (m: number) => pushMoney(fromMinor(m, h.currency, lang));
  const line = h.was != null && h.was > h.price ? copy.alert.line(money(h.was), money(h.price)) : `${money(h.price)}.`;
  const title = why === "sale" ? c.saleStarted(label) : why === "new" ? c.justAdded(label) : why === "followed" ? c.fromFollowed : c.onSale(label);
  // The title names the brand except on "from a brand you follow"; the body always fits 90.
  const room = 88 - line.length;
  const lead = why === "followed" ? `${label} ${pushName(h.brand, h.name, lang, Math.max(12, room - label.length - 3))}` : pushName(h.brand, h.name, lang, Math.max(12, room - 2));
  return { title, body: `${lead}: ${line}` };
}

/** The day's facts for one market, read once per run per country. A price flipping back and forth is not a new drop. */
async function factsFor(db: Db, country: string, now: Date): Promise<BrandFacts> {
  const at = now.toISOString();
  const deals = await db.query<{ brand: string; n: number }>(
    `SELECT p.brand, count(DISTINCT p.id)::int AS n
       FROM events e JOIN products p ON p.id = e.product_id
      WHERE e.type = 'price_drop' AND e.ts > $1::timestamptz - interval '24 hours' AND e.ts <= $1::timestamptz
        AND abs(e.pct) >= $3 AND p.in_stock AND p.country = $2
        AND p.first_seen <= $1::timestamptz - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM events prev WHERE prev.product_id = e.product_id AND prev.type = 'price_drop'
                         AND prev.id <> e.id AND prev.ts < e.ts AND prev.ts > e.ts - interval '30 days' AND prev.new_price <= e.new_price)
      GROUP BY p.brand`,
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
    deals: new Map(deals.map((r) => [r.brand, r.n])),
    arrivals: new Map(arrivals.map((r) => [r.brand, r.n])),
    sales: new Set(sales.map((r) => r.brand)),
  };
}

/** Each brand's deepest cuts under the market's price ceiling, read once per run per country; new arrivals of the brands with a burst. */
async function heroesFor(db: Db, country: string, facts: BrandFacts, now: Date): Promise<{ deals: Map<string, Hero[]>; fresh: Map<string, Hero[]> }> {
  const [band] = await db.query<{ p50: number | null; p75: number | null }>(
    `SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY current_price))::int AS p50,
            (percentile_cont(0.75) WITHIN GROUP (ORDER BY current_price))::int AS p75
       FROM catalogue_items WHERE country = $1 AND in_stock AND pct > 0 AND product_type = ANY($2::text[])`,
    [country, TYPES],
  );
  const p50 = Number(band?.p50 ?? 0), p75 = Number(band?.p75 ?? 0);
  const out = { deals: new Map<string, Hero[]>(), fresh: new Map<string, Hero[]>() };
  if (!p75) return out;
  const shape = (r: Record<string, unknown>): Hero => ({
    id: Number(r.id), brand: String(r.brand), name: String(r.name), price: Number(r.price), was: r.was == null ? null : Number(r.was), pct: Number(r.pct ?? 0),
    currency: (r.currency as string | null) ?? null, image: (r.image as string | null) ?? null, gender: (r.gender as string | null) ?? null, small: Number(r.price) <= p50,
  });
  const rows = await db.query<Record<string, unknown>>(
    // Per brand: one list by depth of cut cut Zara's 40-50% off the end behind every outlet's 85%.
    `SELECT id, brand, name, price, was, pct, currency, image, gender FROM (
       SELECT *, row_number() OVER (PARTITION BY brand ORDER BY (pct <= ${REAL_CUT}) DESC, (price <= $6) DESC, pct DESC, price ASC) AS n FROM (
       SELECT DISTINCT ON (gk) id, gk, brand, name, current_price AS price, current_list_price AS was, pct, currency, image_url AS image, gender
         FROM catalogue_items
        WHERE country = $1 AND in_stock AND pct >= $2 AND image_url IS NOT NULL AND product_type = ANY($3::text[]) AND current_price <= $4
          AND last_seen > $5::timestamptz - interval '3 days' AND NOT (brand = ANY($7::text[]))
          AND NOT EXISTS (SELECT 1 FROM product_link_checks l WHERE l.product_id = catalogue_items.id AND l.broken)
        ORDER BY gk, pct DESC) a) x
      WHERE n <= 40 ORDER BY brand, n`,
    [country, HERO_PCT, TYPES, p75, now.toISOString(), p50, BEAUTY],
  );
  for (const r of rows) {
    const h = shape(r);
    const list = out.deals.get(h.brand) ?? [];
    if (list.length < 40) { list.push(h); out.deals.set(h.brand, list); }
  }
  const burst = [...facts.arrivals.keys()];
  if (burst.length) {
    const fresh = await db.query<Record<string, unknown>>(
      `SELECT c.id, c.brand, c.name, c.current_price AS price, c.current_list_price AS was, c.pct, c.currency, c.image_url AS image, c.gender
         FROM catalogue_items c JOIN products p ON p.id = c.id
        WHERE c.country = $1 AND c.brand = ANY($2::text[]) AND c.in_stock AND c.image_url IS NOT NULL AND c.product_type = ANY($3::text[]) AND c.current_price <= $4
          AND p.first_seen > $5::timestamptz - interval '24 hours' AND c.last_seen > $5::timestamptz - interval '3 days'
        ORDER BY c.current_price ASC LIMIT 400`,
      [country, burst, TYPES, p75, now.toISOString()],
    );
    for (const r of fresh) {
      const h = shape(r);
      const list = out.fresh.get(h.brand) ?? [];
      if (list.length < 20) { list.push(h); out.fresh.set(h.brand, list); }
    }
  }
  return out;
}

interface Row {
  token: string; lang: string | null; tz: string | null; prefs: unknown; storefront: string | null;
  tracked: string[] | null; tracked_country: string | null; tracked_men: number; tracked_women: number;
  last_nudge: Date | string | null;
  /** Products pushed to this device lately, as nudges or alerts. */
  seen: (number | string)[] | null;
  recent_brands: string[] | null;
}

const asDate = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v : new Date(v));

export function dailyWindowOpen(tz: string | null, now: Date): boolean {
  const m = localMinutes(tz || NEWS_DEFAULT_TZ, now);
  return m != null && m >= WINDOW_FROM && m < WINDOW_TO;
}

export async function pushBrands(db: Db, opts: { now?: Date; send?: NewsSend } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? realNewsSend;
  const rows = await db.query<Row>(
    `SELECT d.token, d.lang, d.tz, d.prefs, d.storefront,
            (SELECT array_agg(DISTINCT p.brand) FROM push_watch w JOIN products p ON p.id = w.product_id WHERE w.token = d.token) AS tracked,
            (SELECT min(p.country) FROM push_watch w JOIN products p ON p.id = w.product_id WHERE w.token = d.token) AS tracked_country,
            (SELECT count(*)::int FROM push_watch w JOIN products p ON p.id = w.product_id WHERE w.token = d.token AND p.gender = 'erkek') AS tracked_men,
            (SELECT count(*)::int FROM push_watch w JOIN products p ON p.id = w.product_id WHERE w.token = d.token AND p.gender = 'kadin') AS tracked_women,
            GREATEST((SELECT max(sent_at) FROM push_log l WHERE l.token = d.token AND l.nudge),
                     (SELECT max(sent_at) FROM push_news n WHERE n.token = d.token)) AS last_nudge,
            (SELECT array_agg(DISTINCT l.product_id) FROM push_log l WHERE l.token = d.token AND l.product_id IS NOT NULL
               AND l.sent_at > $1::timestamptz - interval '${REPEAT_DAYS} days') AS seen,
            (SELECT array_agg(DISTINCT split_part(l.key, ':', 3)) FROM push_log l WHERE l.token = d.token AND l.kind = 'brand'
               AND l.sent_at > $1::timestamptz - interval '48 hours') AS recent_brands
       FROM push_devices d`,
    [now.toISOString()],
  );
  const facts = new Map<string, Promise<BrandFacts>>();
  const factsOnce = (country: string) => {
    if (!facts.has(country)) facts.set(country, factsFor(db, country, now));
    return facts.get(country)!;
  };
  const heroes = new Map<string, ReturnType<typeof heroesFor>>();
  const heroesOnce = (country: string, f: BrandFacts) => {
    if (!heroes.has(country)) heroes.set(country, heroesFor(db, country, f, now));
    return heroes.get(country)!;
  };
  let sent = 0;
  const dead: string[] = [];
  for (const r of rows) {
    const kind = classifyToken(r.token);
    if (kind === "expo" || kind === null) continue;
    const prefs = devicePrefs(r.prefs);
    if (prefs?.news === false || !dailyWindowOpen(r.tz, now) || inQuietHours(r.tz || NEWS_DEFAULT_TZ, now, prefs)) continue;
    const last = asDate(r.last_nudge);
    if (last && now.getTime() - last.getTime() < NUDGE_GAP_MS) continue;
    const country = prefs?.country ?? r.tracked_country ?? r.storefront ?? ((r.tz || NEWS_DEFAULT_TZ) === NEWS_DEFAULT_TZ ? "TR" : null);
    if (!country) continue;
    const favourites = [...new Set([...(prefs?.brands ?? []), ...(r.tracked ?? [])])];
    const f = await factsOnce(country);
    const { deals, fresh } = await heroesOnce(country, f);
    const seen = new Set((r.seen ?? []).map(Number));
    const wearer = r.tracked_men > r.tracked_women ? "erkek" : "kadin";
    const fits = (h: Hero) => !seen.has(h.id) && h.pct >= (prefs?.minPct ?? 0) && (h.gender == null || h.gender === wearer || h.gender === "unisex");
    const day = localDate(r.tz, now);
    const seed = `${r.token}:${day}`;
    const signal = pickSignal(favourites, f, new Set(r.recent_brands ?? []));
    let why: "sale" | "deals" | "new" | "followed" | "pick" = "pick";
    let hero: Hero | null = null;
    if (signal) {
      hero = chooseHero((signal.kind === "new" ? fresh : deals).get(signal.brand)?.filter((h) => !seen.has(h.id) && (h.gender == null || h.gender === wearer || h.gender === "unisex")) ?? [], seed);
      if (hero) why = signal.kind;
    }
    if (!hero) {
      const list = favourites.flatMap((b) => deals.get(b) ?? []).filter(fits);
      hero = chooseHero(list, seed);
      if (hero) why = "followed";
    }
    if (!hero) {
      const names = new Set(householdNames(country as CountryCode));
      const list = [...deals.entries()]
        .filter(([b]) => !NOT_A_PICK.has(b) && names.has(b))
        .flatMap(([, l]) => l.filter(fits));
      hero = chooseHero(list, seed);
      why = "pick";
    }
    if (!hero) continue;
    const m = buildDailyPush(r.lang, why, hero);
    const key = `brand:${why}:${hero.brand}:${day}`;
    const content: PushContent = { title: m.title, body: m.body, kind: "news", productId: hero.id, href: `/product/${hero.id}`, sound: "coin", coinChannel: hasCoinChannel(r.prefs), ...(hero.image ? { image: hero.image } : {}) };
    const out = await send(r.token, content);
    if (out === "dead") { dead.push(r.token); continue; }
    if (out !== "ok") continue;
    sent++;
    await db.query(`INSERT INTO push_news (token, key, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [r.token, key, now.toISOString()]);
    await logPushes(db, [{ token: r.token, kind: "brand", nudge: true, key, productId: hero.id }], now);
  }
  if (dead.length) await db.query(`DELETE FROM push_devices WHERE token = ANY($1)`, [dead]);
  if (sent) console.log(`daily push: ${sent} sent`);
  return sent;
}
