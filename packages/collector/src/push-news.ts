/**
 * News pushes (2026-10-03): the evening deal round-up here, and the brand
 * sale-start and sale-calendar reminders added beside it.
 *
 * Owner: "every day maybe it's bad to send message, but generally good idea".
 * So a round-up goes to a device at most once per 48h (was 72h until 2026-10-21), only between 20:30 and
 * 21:59 on the device's own clock (Turkey's shopping peak — research in
 * docs/marketing/daily-engagement-research-2026-10-03.md), only when there are
 * at least 5 fresh drops on brands the device tracks, and never when the
 * device switched news off. Personal alerts (drop, target, restock) are not
 * news: nothing here caps or delays them.
 *
 * A device that never sent a time zone is read as Istanbul. For personal
 * alerts "no tz" means never quiet; for news that would mean a 03:00 push.
 */
import type { Db } from "./db";
import { devicePrefs, inQuietHours } from "./push";
import { classifyToken, loadCreds, sendApns, sendFcm, type PushContent } from "./push-transport";
import { BRAND_LABELS } from "../../../lib/format";
import { dueCampaigns } from "./sale-calendar";
import { serverCopy } from "./i18n/server";
import { logPushes, nudgeAllowed } from "./push-log";

type Outcome = "ok" | "dead" | "retry";
export type NewsSend = (token: string, c: PushContent) => Promise<Outcome>;

const MIN_DROPS = 5;
const MIN_PCT = 20;
// The round-up's own floor; the shared nudge budget (push-log.ts) is 48 h.
const BUDGET_MS = 48 * 3600_000;
export const NEWS_DEFAULT_TZ = "Europe/Istanbul";

/** 20:30-21:59 on the device's clock. */
export function newsWindowOpen(tz: string | null, now: Date): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || NEWS_DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return false; // an unusable zone never gets news
  }
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  const mins = h * 60 + m;
  return mins >= 20 * 60 + 30 && mins < 22 * 60;
}

/**
 * Where a news push lands (2026-10-29): Yeni with the push's own window and
 * brands. It used to open plain `/yeni`, which shows drops since the reader's
 * LAST VISIT on their FOLLOWED brands — a round-up counted the last 48 h on the
 * brands of their TRACKED products, so a tap often opened an empty screen
 * (owner: "it brings to a page with no deals"). Seconds and %2C keep the href
 * inside the app's link check (src/notifications/pushOpen.ts); an app without
 * this change just opens Yeni as before.
 */
export function yeniHref(since: Date, brands: string[]): string {
  const q = [`since=${Math.floor(since.getTime() / 1000)}`];
  if (brands.length) q.push(`brands=${brands.map(encodeURIComponent).join("%2C")}`);
  return `/yeni?${q.join("&")}`;
}

/** One round-up per device per 48h (owner 2026-10-21: "every 2 days"). */
export function newsBudgetOk(last: Date | null, now: Date): boolean {
  return !last || now.getTime() - last.getTime() >= BUDGET_MS;
}

/** The device's local calendar date, for message keys. */
export function localDate(tz: string | null, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || NEWS_DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function buildDigest(lang: string | null, n: number, brands: string[]): { title: string; body: string } {
  const c = serverCopy(lang).news;
  const names = brands.slice(0, 3).map((b) => BRAND_LABELS[b] ?? b);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${c.and} ${names[names.length - 1]}` : names[0] ?? "";
  return { title: c.digestTitle(n), body: c.digestBody(list) };
}

export function buildSaleStart(lang: string | null, brand: string): { title: string; body: string } {
  const c = serverCopy(lang).news;
  return { title: c.saleStartTitle(BRAND_LABELS[brand] ?? brand), body: c.saleStartBody };
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

export interface NewsDevice {
  token: string;
  lang: string | null;
  tz: string | null;
  prefs: unknown;
  last_news: Date | string | null;
  brands: string[];
  country: string;
}

/** Devices that track something, with what news needs to decide. */
export async function newsDevices(db: Db): Promise<NewsDevice[]> {
  return db.query<NewsDevice>(
    `SELECT d.token, d.lang, d.tz, d.prefs,
            (SELECT max(n.sent_at) FROM push_news n WHERE n.token = d.token) AS last_news,
            array_agg(DISTINCT p.brand) AS brands, min(p.country) AS country
     FROM push_devices d
     JOIN push_watch w ON w.token = d.token
     JOIN products p ON p.id = w.product_id
     GROUP BY d.token, d.lang, d.tz, d.prefs`,
  );
}

/** Whether this device may get a news push at all right now (window, quiet hours, switch). */
export function newsAwake(d: NewsDevice, now: Date): boolean {
  if (classifyToken(d.token) === "expo" || classifyToken(d.token) === null) return false;
  const prefs = devicePrefs(d.prefs);
  if (prefs?.news === false) return false;
  if (!newsWindowOpen(d.tz, now)) return false;
  return !inQuietHours(d.tz || NEWS_DEFAULT_TZ, now, prefs);
}

const asDate = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v : new Date(v));

export async function pushNews(db: Db, opts: { now?: Date; send?: NewsSend } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? realSend;
  const devices = await newsDevices(db);
  // One budget for every nudge (push-log.ts): 48 h apart, longer when ignored.
  // Sale starts and calendar eves used to be exempt; since 2026-10-21 nothing is.
  const allowed = await nudgeAllowed(db, devices.map((d) => d.token), now);
  let sent = 0;
  let tried = 0;
  const dead: string[] = [];
  const record = async (d: NewsDevice, key: string) => {
    await db.query(`INSERT INTO push_news (token, key, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [d.token, key, now.toISOString()]);
    await logPushes(db, [{ token: d.token, kind: key.split(":")[0], nudge: true, key }], now);
    d.last_news = now; // the same run's later passes see it
    allowed.delete(d.token);
  };
  /** Never two news pushes on one evening, whatever kind. */
  const hadNewsTonight = (d: NewsDevice) => {
    const last = asDate(d.last_news);
    return !!last && now.getTime() - last.getTime() < 12 * 3600_000;
  };

  // 1. Brand sale starts (brand-sales.ts), to devices tracking that brand.
  //    Once per sale per device, inside the shared nudge budget.
  const sales = await db.query<{ brand: string; country: string; started_at: Date | string }>(
    `SELECT brand, country, started_at FROM brand_sales WHERE started_at > $1::timestamptz - interval '24 hours'`,
    [now.toISOString()],
  );
  if (sales.length) {
    const sentKeys = new Set(
      (await db.query<{ token: string; key: string }>(`SELECT token, key FROM push_news WHERE key LIKE 'sale:%'`)).map(
        (r) => `${r.token}|${r.key}`,
      ),
    );
    for (const d of devices) {
      if (!allowed.has(d.token) || !newsAwake(d, now) || hadNewsTonight(d)) continue;
      const sale = sales.find((x) => x.country === d.country && d.brands.includes(x.brand));
      if (!sale) continue;
      const key = `sale:${sale.brand}:${sale.country}:${localDate(null, asDate(sale.started_at)!)}`;
      if (sentKeys.has(`${d.token}|${key}`)) continue;
      tried++;
      const m = buildSaleStart(d.lang, sale.brand);
      // That brand's drops from the day before its sale was noticed.
      const href = yeniHref(new Date(asDate(sale.started_at)!.getTime() - 24 * 3600_000), [sale.brand]);
      const out = await send(d.token, { title: m.title, body: m.body, kind: "news", href });
      if (out === "ok") {
        sent++;
        await record(d, key);
      } else if (out === "dead") dead.push(d.token);
    }
  }

  // 2. Sale-calendar eves (sale-calendar.ts) — to every device that tracks
  //    something. Once per key, inside the shared nudge budget.
  for (const d of devices) {
    if (dead.includes(d.token) || !allowed.has(d.token) || !newsAwake(d, now) || hadNewsTonight(d)) continue;
    const due = dueCampaigns(now, d.tz);
    if (!due.length) continue;
    const have = new Set(
      (await db.query<{ key: string }>(`SELECT key FROM push_news WHERE token = $1`, [d.token])).map((r) => r.key),
    );
    const c = due.find((x) => !have.has(x.key));
    if (!c) continue;
    tried++;
    const m = serverCopy(d.lang).saleCalendar[c.key];
    if (!m) continue;
    const out = await send(d.token, { title: m.title, body: m.body, kind: "news", href: "/yeni" });
    if (out === "ok") {
      sent++;
      await record(d, c.key);
    } else if (out === "dead") dead.push(d.token);
  }

  // 3. The round-up. Fresh drops are counted ONCE per run, not per device —
  //    every eligible device has the same window (its last news is 48h+ old,
  //    or it never had any), and the database is the scarce resource. Grouped
  //    by percentage so each device's own minimum applies in memory.
  let drops: { country: string; brand: string; pct: number; n: number }[] | null = null;
  const dropsByBrand = async () =>
    (drops ??= await db.query<{ country: string; brand: string; pct: number; n: number }>(
      // One row per product (its deepest drop), then counted per percentage.
      `SELECT country, brand, pct, count(*)::int AS n FROM (
         SELECT p.id, p.country, p.brand, max(abs(e.pct))::int AS pct
         FROM events e JOIN products p ON p.id = e.product_id
         WHERE e.type = 'price_drop' AND e.ts > $1::timestamptz - interval '48 hours' AND e.ts <= $1::timestamptz
           AND abs(e.pct) >= $2 AND p.in_stock
         GROUP BY p.id, p.country, p.brand) x
       GROUP BY 1, 2, 3`,
      [now.toISOString(), MIN_PCT],
    ));
  for (const d of devices) {
    if (dead.includes(d.token)) continue;
    if (!newsAwake(d, now)) continue;
    if (!allowed.has(d.token) || !newsBudgetOk(asDate(d.last_news), now)) continue;
    const prefs = devicePrefs(d.prefs);
    const minPct = Math.max(MIN_PCT, prefs?.minPct ?? 0);
    const perBrand = new Map<string, number>();
    for (const r of await dropsByBrand()) {
      if (r.country !== d.country || !d.brands.includes(r.brand) || r.pct < minPct) continue;
      perBrand.set(r.brand, (perBrand.get(r.brand) ?? 0) + r.n);
    }
    const rows = [...perBrand].map(([brand, n]) => ({ brand, n })).sort((a, b) => b.n - a.n);
    const total = rows.reduce((s, r) => s + r.n, 0);
    if (total < MIN_DROPS) continue;
    tried++;
    const m = buildDigest(d.lang, total, rows.map((r) => r.brand));
    // The same 48 h and brands the count above used.
    const href = yeniHref(new Date(now.getTime() - 48 * 3600_000), rows.map((r) => r.brand));
    const out = await send(d.token, { title: m.title, body: m.body, kind: "news", href });
    if (out === "ok") {
      sent++;
      await record(d, `digest:${localDate(d.tz, now)}`);
    } else if (out === "dead") dead.push(d.token);
  }
  if (dead.length) await db.query(`DELETE FROM push_devices WHERE token = ANY($1)`, [dead]);
  if (tried) console.log(`push news: sent ${sent}/${tried} (${dead.length} dead tokens pruned)`);
  return sent;
}
