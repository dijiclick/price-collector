/**
 * First-week series (owner 2026-10-21: "encourage people to use the app
 * regularly"; "don't send every day — every 2 days").
 *
 * For devices that allowed notifications but track nothing yet — about four in
 * five new installs, who otherwise never hear from us. Four pushes, each a
 * reason to open the app AND a step towards tracking something, because a
 * tracked item is what powers every personal alert after that:
 *
 *   day 1  today's biggest drops in their market          → /yeni
 *   day 3  one strong deal, "track it and we'll tell you" → that product
 *   day 5  a Stilist look (where Stilist is open)          → that look
 *   day 7  the week in numbers                            → /yeni
 *
 * Inside the shared nudge budget (push-log.ts: 48 h apart, backing off when
 * ignored), the evening window (20:30-21:59 on the device's clock), quiet hours
 * and the "news" switch. A step is never sent before its day and never after
 * day 9, and the series only moves forward: a device that missed day 1 starts
 * at day 3. The moment a device tracks something it leaves the series.
 */
import type { Db } from "./db";
import { newsAwake, localDate, type NewsDevice } from "./push-news";
import { classifyToken, loadCreds, sendApns, sendFcm, type PushContent } from "./push-transport";
import { logPushes, nudgeAllowed } from "./push-log";
import { BRAND_LABELS, money } from "../../../lib/format";

type Outcome = "ok" | "dead" | "retry";
export type WelcomeSend = (token: string, c: PushContent) => Promise<Outcome>;

export const STEPS = [1, 3, 5, 7] as const;
export type Step = (typeof STEPS)[number];
const LAST_DAY = 9;

/** The next step for a device `ageDays` old whose highest sent step is `done` (0 = none). */
export function pickStep(ageDays: number, done: number): Step | null {
  if (ageDays < 1 || ageDays >= LAST_DAY) return null;
  const due = STEPS.filter((s) => s <= ageDays && s > done);
  return due.length ? due[due.length - 1] : null;
}

const label = (b: string) => BRAND_LABELS[b] ?? b;
const short = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function drops1(lang: string | null, n: number, brands: string[]): { title: string; body: string } {
  const top = brands.slice(0, 2).map(label).join(lang === "en" ? " and " : " ve ");
  return lang === "en"
    ? { title: `${n} items dropped 30%+ today`, body: `${top} lead today's drops. Have a look before your size goes.` }
    : { title: `Bugün ${n} üründe %30+ indirim`, body: `${top} başı çekiyor. Bedenin tükenmeden göz at.` };
}

export function deal3(lang: string | null, d: { brand: string; name: string; price: number; currency: string | null; pct: number }): { title: string; body: string } {
  const price = money(d.price, d.currency);
  return lang === "en"
    ? { title: `${label(d.brand)}: ${d.pct}% off`, body: `${short(d.name)} is now ${price}. Tap ♡ to track it — we'll tell you if it drops again.` }
    : { title: `${label(d.brand)}: %${d.pct} indirim`, body: `${short(d.name)} şimdi ${price}. ♡ ile takibe al, daha da düşerse ilk sen öğren.` };
}

export function look5(lang: string | null, headline: { tr: string; en: string } | null): { title: string; body: string } {
  return lang === "en"
    ? { title: headline?.en ?? "A look picked for you", body: "Our stylist put an outfit together from today's deals. Swap any piece with one tap." }
    : { title: headline?.tr ?? "Sana özel bir kombin", body: "Stilistimiz bugünün indirimlerinden bir kombin hazırladı. Her parçayı tek dokunuşla değiştir." };
}

export function week7(lang: string | null, n: number): { title: string; body: string } {
  return lang === "en"
    ? { title: `${n.toLocaleString("en-GB")} new deals this week`, body: "Track one item you like and we'll only message you about what's yours." }
    : { title: `Bu hafta ${n.toLocaleString("tr-TR")} yeni indirim`, body: "Beğendiğin bir ürünü takibe al, sadece senin ürünlerin için haber verelim." };
}

async function realSend(token: string, c: PushContent): Promise<Outcome> {
  const creds = loadCreds();
  const kind = classifyToken(token);
  if (kind === "apns" && creds.apns) {
    const r = await sendApns(creds.apns, token, c);
    return r.ok ? "ok" : r.dead ? "dead" : "retry";
  }
  if (kind === "fcm" && creds.fcm) {
    const r = await sendFcm(creds.fcm, token, c);
    return r.ok ? "ok" : r.dead ? "dead" : "retry";
  }
  return "retry";
}

interface Row { token: string; lang: string | null; tz: string | null; prefs: unknown; created_at: Date | string; country: string | null; done: number }

const TYPES = ["ust", "alt", "elbise", "dis-giyim", "triko", "ayakkabi", "canta"];

export async function pushWelcome(db: Db, opts: { now?: Date; send?: WelcomeSend } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? realSend;
  const rows = await db.query<Row>(
    `SELECT d.token, d.lang, d.tz, d.prefs, d.created_at, d.storefront AS country,
            COALESCE((SELECT max(split_part(n.key, ':', 2)::int) FROM push_news n
                       WHERE n.token = d.token AND n.key ~ '^welcome:[0-9]+$'), 0) AS done
       FROM push_devices d
      WHERE d.created_at <= $1::timestamptz - interval '1 day'
        AND d.created_at >  $1::timestamptz - interval '${LAST_DAY} days'
        AND NOT EXISTS (SELECT 1 FROM push_watch w WHERE w.token = d.token)`,
    [now.toISOString()],
  );
  if (!rows.length) return 0;
  const markets = new Set((await db.query<{ country: string }>(`SELECT DISTINCT country FROM catalogue_items`)).map((r) => r.country));
  const allowed = await nudgeAllowed(db, rows.map((r) => r.token), now);
  const cache = new Map<string, unknown>();
  const once = async <T>(k: string, f: () => Promise<T>): Promise<T> => {
    if (!cache.has(k)) cache.set(k, await f());
    return cache.get(k) as T;
  };
  let sent = 0;
  const dead: string[] = [];
  for (const r of rows) {
    const country = r.country && markets.has(r.country) ? r.country : "TR";
    const dev: NewsDevice = { token: r.token, lang: r.lang, tz: r.tz, prefs: r.prefs, last_news: null, brands: [], country };
    if (!allowed.has(r.token) || !newsAwake(dev, now)) continue;
    const age = (now.getTime() - new Date(r.created_at).getTime()) / 86_400_000;
    let step = pickStep(age, r.done);
    if (!step) continue;
    let content: PushContent | null = null;
    let productId: number | null = null;
    for (let tries = 0; step && !content && tries < 4; tries++) {
      if (step === 1) {
        const d = await once(`d1:${country}`, () => db.query<{ brand: string; n: number }>(
          `SELECT p.brand, count(DISTINCT p.id)::int AS n FROM events e JOIN products p ON p.id = e.product_id
            WHERE e.type = 'price_drop' AND e.ts > $1::timestamptz - interval '24 hours' AND abs(e.pct) >= 30
              AND p.in_stock AND p.country = $2 GROUP BY 1 ORDER BY 2 DESC`, [now.toISOString(), country]));
        const n = d.reduce((s, x) => s + x.n, 0);
        if (n >= 10) content = { ...drops1(r.lang, n, d.map((x) => x.brand)), kind: "news", href: "/yeni" };
      } else if (step === 3) {
        const [d] = await once(`d3:${country}:${localDate(r.tz, now)}`, () => db.query<{ id: number; brand: string; name: string; price: number; currency: string | null; pct: number }>(
          `SELECT id, brand, name, current_price AS price, currency, round(pct)::int AS pct FROM catalogue_items
            WHERE country = $1 AND in_stock AND image_url IS NOT NULL AND pct BETWEEN 40 AND 75
              AND (gender = 'kadin' OR gender IS NULL) AND product_type = ANY($2)
            ORDER BY md5(id::text || $3) LIMIT 1`, [country, TYPES, localDate(null, now)]));
        if (d) { content = { ...deal3(r.lang, d), kind: "news", href: `/product/${d.id}` }; productId = d.id; }
      } else if (step === 5) {
        const [d] = await once(`d5:${country}`, () => db.query<{ product_id: number; headline_tr: string | null; headline_en: string | null }>(
          `SELECT l.product_id, l.headline_tr, l.headline_en FROM stylist_looks l
             JOIN stylist_pool s ON s.id = l.product_id
             LEFT JOIN stylist_countries c ON c.country = s.country
            WHERE l.verdict = 'ok' AND l.judged_at > $1::timestamptz - interval '3 days'
              AND s.country = $2 AND s.gender = 'kadin' AND s.pct > 0
              AND (s.country = 'TR' OR (c.discounted > 0 AND c.tagged::float / c.discounted >= 0.9))
            ORDER BY l.score DESC NULLS LAST, md5(l.product_id::text || $3) LIMIT 1`, [now.toISOString(), country, localDate(null, now)]).catch(() => []));
        if (d) {
          content = { ...look5(r.lang, d.headline_tr && d.headline_en ? { tr: d.headline_tr, en: d.headline_en } : null), kind: "news", href: `/kombin/${d.product_id}` };
          productId = d.product_id;
        }
      } else {
        const [d] = await once(`d7:${country}`, () => db.query<{ n: number }>(
          `SELECT count(DISTINCT p.id)::int AS n FROM events e JOIN products p ON p.id = e.product_id
            WHERE e.type = 'price_drop' AND e.ts > $1::timestamptz - interval '7 days' AND abs(e.pct) >= 20 AND p.country = $2`,
          [now.toISOString(), country]));
        if (d && d.n >= 20) content = { ...week7(r.lang, d.n), kind: "news", href: "/yeni" };
      }
      // Nothing worth saying for this step (no Stilist here, a quiet day): try the next one.
      if (!content) step = STEPS.find((s) => s > step!) ?? null;
    }
    if (!content || !step) continue;
    const out = await send(r.token, content);
    if (out === "ok") {
      sent++;
      const key = `welcome:${step}`;
      await db.query(`INSERT INTO push_news (token, key, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [r.token, key, now.toISOString()]);
      await logPushes(db, [{ token: r.token, kind: "welcome", nudge: true, key, productId }], now);
    } else if (out === "dead") dead.push(r.token);
  }
  if (dead.length) await db.query(`DELETE FROM push_devices WHERE token = ANY($1)`, [dead]);
  console.log(`push welcome: sent ${sent} of ${rows.length} new non-tracking devices`);
  return sent;
}
