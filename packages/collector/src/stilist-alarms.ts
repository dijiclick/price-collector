/**
 * Stilist alarms (2026-10-11, a Premium feature: free 1, Premium unlimited).
 *
 * A shopper saves a Stilist search ("siyah deri bot, 2.000 TL altı, 38") from
 * the app (app/api/alarms). After each run this checks every alarm against what
 * happened since its last check — products that are NEW, that DROPPED in price
 * or came BACK in stock — and pushes when something matches:
 *
 *   "Asistan alarmı: 3 yeni eşleşme" / "Siyah deri bot, 2.000 TL altı — Zara Deri bot ₺1.890"
 *
 * Tapping it opens the product the message names (href /product/<id>) — the
 * owner (2026-10-19): a push that names one item and its price must land on
 * that item, not on a search page. At most
 * one push per alarm per 6 hours, never in the device's quiet hours, and the
 * check window only moves forward when the alarm was looked at, so a quiet
 * night's matches go out in the morning instead of being lost.
 *
 * Matching runs on catalogue_items (lib/feed-cache.ts) — compact, in memory,
 * every live product of the launched markets — joined to the run's events.
 */
import { logPushes, nudgeAllowed } from "./push-log";
import type { Db } from "./db";
import { devicePrefs, inQuietHours } from "./push";
import { classifyToken, hasCoinChannel, loadCreds, sendApns, sendFcm, type PushContent } from "./push-transport";
import { BRAND_LABELS, money } from "../../../lib/format";
import { serverCopy } from "./i18n/server";
import { materialSql } from "../../../lib/materials";

type Outcome = "ok" | "dead" | "retry";
export type AlarmSend = (token: string, c: PushContent) => Promise<Outcome>;

const COOLDOWN_MS = 6 * 3600_000;
/**
 * Remembered searches (lib/interests.ts) are the app reaching out unasked, so
 * they are rationed: one push per DEVICE per 48 h across all of them, new
 * products only, and the search is forgotten after 14 days.
 */
const IMPLICIT_COOLDOWN_MS = 48 * 3600_000;
const IMPLICIT_TTL_MS = 14 * 24 * 3600_000;
/** An alarm older than this many days of silence still only looks back this far. */
const MAX_LOOKBACK_H = 48;
const FOLD = (col: string) => `lower(translate(${col}, 'ÇĞİÖŞÜIÂÎÛçğıöşüâîû', 'cgiosuiaiucgiosuaiu'))`;

/** The validated filter object the assistant stores (lib/assistant.ts AssistantFilters). */
export interface AlarmFilters {
  brands?: string[];
  type?: string | null;
  types?: string[];
  subtype?: string | null;
  gender?: string | null;
  colors?: string[];
  materials?: string[];
  pmin?: number | null;
  pmax?: number | null;
  sizes?: string[];
  onSale?: boolean;
  q?: string;
}

interface AlarmRow {
  id: number;
  token: string;
  country: string;
  lang: string | null;
  filters: AlarmFilters | string;
  summary: string | null;
  checked_at: Date | string;
  last_notified_at: Date | string | null;
  created_at?: Date | string;
  implicit?: boolean;
  tz: string | null;
  prefs: unknown;
}

const foldWord = (w: string) =>
  w.toLocaleLowerCase("tr-TR").replace(/[çğıöşüâîû]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" })[c] ?? c).replace(/[^a-z0-9]/g, "");

/** WHERE clause + params for one alarm's filters on catalogue_items `c`. Exported for tests. */
export function alarmWhere(f: AlarmFilters, country: string, since: string, newOnly = false): { sql: string; params: unknown[] } {
  const params: unknown[] = [country, since];
  let sql = `c.country = $1 AND c.in_stock`;
  const add = (clause: (i: number) => string, v: unknown) => {
    params.push(v);
    sql += ` AND ${clause(params.length)}`;
  };
  if (f.brands?.length) add((i) => `c.brand = ANY($${i}::text[])`, f.brands);
  if (f.type) add((i) => `c.product_type = $${i}`, f.type);
  else if (f.types?.length) add((i) => `c.product_type = ANY($${i}::text[])`, f.types);
  if (f.type && f.subtype) add((i) => `c.product_subtype = $${i}`, f.subtype);
  if (f.gender) add((i) => `c.gender = $${i}`, f.gender);
  if (f.colors?.length) add((i) => `c.color_families && $${i}::text[]`, f.colors);
  // Same reading as the search (lib/materials.ts): "kırmızı triko" must not
  // push a new sweatshirt.
  if (f.materials?.length) {
    const m = materialSql(f.materials, (v) => {
      params.push(v);
      return `$${params.length}`;
    }, { table: "c", narrow: true });
    if (m) sql += ` AND ${m}`;
  }
  if (f.pmin) add((i) => `c.current_price >= $${i}`, Math.round(f.pmin * 100));
  if (f.pmax) add((i) => `c.current_price <= $${i}`, Math.round(f.pmax * 100));
  if (f.sizes?.length) add((i) => `(c.sizeless OR c.avail_sizes && $${i}::text[])`, f.sizes.map((s) => s.toUpperCase()));
  if (f.onSale) sql += ` AND c.pct > 0`;
  for (const w of (f.q ?? "").split(/\s+/).map(foldWord).filter((w) => w.length >= 2).slice(0, 2)) {
    add((i) => `${FOLD("c.name")} ~ $${i}`, `\\y${w}`);
  }
  // Only what changed since the alarm was last checked.
  sql += ` AND c.id IN (SELECT e.product_id FROM events e WHERE e.ts > $2::timestamptz
                         AND e.type IN (${newOnly ? "'new_product'" : "'new_product', 'price_drop', 'back_in_stock'"}))`;
  return { sql, params };
}

export function alarmMessage(lang: string | null, summary: string | null, n: number, top: { brand: string; name: string; price: number; currency: string | null }): { title: string; body: string } {
  const item = `${BRAND_LABELS[top.brand] ?? top.brand} ${top.name} ${money(top.price, top.currency)}`;
  return { title: serverCopy(lang).stilist.alarmTitle(n), body: summary ? `${summary} — ${item}` : item };
}

/** "You searched for X: N new products" — the brand of the best one named. */
export function interestMessage(lang: string | null, summary: string | null, n: number, top: { brand: string; name: string; price: number; currency: string | null }): { title: string; body: string } {
  const c = serverCopy(lang).stilist;
  const brand = BRAND_LABELS[top.brand] ?? top.brand;
  const item = `${brand} ${top.name} ${money(top.price, top.currency)}`;
  const what = summary ? `“${summary}”` : c.yourSearch;
  return { title: c.interestTitle(what, n), body: c.interestBody(item) };
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

const asDate = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v : new Date(v));

/** Check every alarm, push the ones with matches. Never throws; returns pushes sent. */
export async function pushStilistAlarms(db: Db, opts: { now?: Date; send?: AlarmSend } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? realSend;
  let alarms: AlarmRow[];
  try {
    alarms = await db.query<AlarmRow>(
      `SELECT a.id, a.token, a.country, a.lang, a.filters, a.summary, a.checked_at, a.last_notified_at, a.created_at,
              COALESCE(a.implicit, false) AS implicit, d.tz, d.prefs
         FROM stilist_alarms a LEFT JOIN push_devices d ON d.token = a.token
        ORDER BY a.implicit, a.id LIMIT 5000`,
    );
  } catch (err) {
    console.error("stilist alarms: not readable:", err instanceof Error ? err.message : err);
    return 0;
  }
  let sent = 0;
  // Remembered searches are nudges (push-log.ts): inside the shared 48 h budget.
  // Saved alarms are personal — the shopper asked for them — and are not.
  const allowed = await nudgeAllowed(db, [...new Set(alarms.filter((a) => a.implicit).map((a) => a.token))], now);
  // The newest implicit push each device has had — the 48 h ration is per
  // device, across all its remembered searches.
  const lastImplicit = new Map<string, number>();
  for (const a of alarms) {
    const t = asDate(a.last_notified_at)?.getTime();
    if (a.implicit && t) lastImplicit.set(a.token, Math.max(lastImplicit.get(a.token) ?? 0, t));
  }
  for (const a of alarms) {
    try {
      const last = asDate(a.last_notified_at);
      if (last && now.getTime() - last.getTime() < COOLDOWN_MS) continue;
      const prefs = devicePrefs(a.prefs);
      if (a.implicit) {
        const born = asDate(a.created_at ?? null);
        if (born && now.getTime() - born.getTime() > IMPLICIT_TTL_MS) {
          await db.query(`DELETE FROM stilist_alarms WHERE id = $1`, [a.id]);
          continue;
        }
        if (now.getTime() - (lastImplicit.get(a.token) ?? 0) < IMPLICIT_COOLDOWN_MS) continue;
        if (prefs && prefs.news === false) continue; // "Haberler ve fırsatlar" off means no reminders
        if (!allowed.has(a.token)) continue;
      }
      if (inQuietHours(a.tz || "Europe/Istanbul", now, prefs)) continue; // window stays open until morning
      const floor = new Date(now.getTime() - MAX_LOOKBACK_H * 3600_000);
      const checked = asDate(a.checked_at) ?? floor;
      const since = (checked > floor ? checked : floor).toISOString();
      const f = (typeof a.filters === "string" ? JSON.parse(a.filters) : a.filters) as AlarmFilters;
      const { sql, params } = alarmWhere(f, a.country, since, !!a.implicit);
      const rows = await db.query<{ n: number; brand: string; name: string; price: number; currency: string | null; id: number }>(
        `SELECT count(*) OVER ()::int AS n, c.id, c.brand, c.name, c.current_price AS price, c.currency
           FROM catalogue_items c WHERE ${sql}
          ORDER BY c.pct DESC, c.current_price ASC LIMIT 1`,
        params,
      );
      if (!rows.length) {
        await db.query(`UPDATE stilist_alarms SET checked_at = $2 WHERE id = $1`, [a.id, now.toISOString()]);
        continue;
      }
      const msg = a.implicit ? interestMessage(a.lang, a.summary, rows[0].n, rows[0]) : alarmMessage(a.lang, a.summary, rows[0].n, rows[0]);
      const outcome = await send(a.token, { title: msg.title, body: msg.body, kind: "news", href: `/product/${rows[0].id}`, sound: "coin", coinChannel: hasCoinChannel(a.prefs) });
      if (outcome === "dead") {
        await db.query(`DELETE FROM stilist_alarms WHERE token = $1`, [a.token]);
      } else if (outcome === "ok") {
        sent += 1;
        if (a.implicit) { lastImplicit.set(a.token, now.getTime()); allowed.delete(a.token); }
        await logPushes(db, [{ token: a.token, kind: a.implicit ? "search" : "alarm", nudge: !!a.implicit, key: `alarm:${a.id}`, productId: rows[0].id }], now);
        await db.query(`UPDATE stilist_alarms SET checked_at = $2, last_notified_at = $2 WHERE id = $1`, [a.id, now.toISOString()]);
      } // "retry": the window stays open and the next run tries again
    } catch (err) {
      console.error(`stilist alarm ${a.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (alarms.length) console.log(`stilist alarms: ${alarms.length} checked, ${sent} pushed`);
  return sent;
}
