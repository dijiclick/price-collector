import type { Db } from "./db";
import { fromMinor } from "./normalize";
import { BRAND_LABELS } from "../../../lib/format";
import {
  classifyToken, loadCreds, sendApns, sendFcm, type PushContent,
} from "./push-transport";

export interface PushRow {
  token: string;
  target: number | null;
  event_id: number;
  product_id: number;
  old_price: number;
  new_price: number;
  pct: number;
  name: string;
  brand: string;
  size: string | null;
  type: "price_drop" | "back_in_stock";
  /** null for devices that synced before the language setting existed. */
  lang: "tr" | "en" | null;
  /**
   * The product's currency (`products.currency`). null for rows written before
   * the column had a non-TRY value in it, which means lira.
   */
  currency: string | null;
  /** push_devices.tz — IANA zone for quiet hours. null/absent: never quiet. */
  tz?: string | null;
  /** events.ts — when the drop was detected, for dropping stale held alerts. */
  event_ts?: string | Date | null;
}

/**
 * `kind`/`pct` mirror the app's `InboxKind` and exist so the device can apply
 * Bildirim tercihleri (per-kind toggles, the minimum-discount threshold) at
 * delivery time. Without them the client can only enforce quiet hours, and the
 * preferences screen silently does nothing — which is what shipped in 1.1.
 */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { productId: number; kind: "drop" | "target" | "restock"; pct?: number };
  channelId: string;
}

/**
 * Notification copy, per language.
 *
 * A device that synced before the language setting existed has `lang` null and
 * keeps getting Turkish — which is what it was already receiving, so nothing
 * changes under anyone.
 *
 * A price is in whatever the shop charges — `products.currency`, not the
 * reader's language. Only the SEPARATORS follow the language, which is why the
 * percentage and the arrow are built here rather than inline. Converting would
 * invent a price nobody is charging, and a lira sign over a British amount is
 * that mistake in the smallest possible space.
 */
const COPY = {
  tr: {
    restock: (size: string | null) => (size ? `Beden ${size} tekrar stokta 🎉` : "Tekrar stokta 🎉"),
    target: (drop: string) => `🎯 Hedefe ulaştı — ${drop}`,
    withSize: (size: string, base: string) => `Beden ${size} · ${base}`,
    pct: (n: number) => `−%${n}`,
  },
  en: {
    restock: (size: string | null) => (size ? `Size ${size} is back in stock 🎉` : "Back in stock 🎉"),
    target: (drop: string) => `🎯 Hit your target — ${drop}`,
    withSize: (size: string, base: string) => `Size ${size} · ${base}`,
    pct: (n: number) => `−${n}%`,
  },
};

export function buildMessage(r: PushRow): PushMessage {
  const c = COPY[r.lang ?? "tr"] ?? COPY.tr;
  const title = `${BRAND_LABELS[r.brand] ?? r.brand} · ${r.name}`;
  if (r.type === "back_in_stock") {
    return {
      to: r.token,
      title,
      body: c.restock(r.size),
      data: { productId: r.product_id, kind: "restock" },
      channelId: "price-drops",
    };
  }
  const money = (m: number) => fromMinor(m, r.currency, r.lang);
  const drop = `${money(r.old_price)} → ${money(r.new_price)} (${c.pct(Math.abs(r.pct))})`;
  const goal = r.target != null && r.new_price <= r.target;
  const base = goal ? c.target(drop) : drop;
  return {
    to: r.token,
    title,
    body: r.size ? c.withSize(r.size, base) : base,
    // A drop that reaches the user's target is a "target" event to the app, so
    // muting plain drops never swallows the alert they explicitly asked for.
    data: { productId: r.product_id, kind: goal ? "target" : "drop", pct: Math.abs(r.pct) },
    channelId: "price-drops",
  };
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

interface Ticket {
  status: string;
  details?: { error?: string };
}

/* ------------------------------------------------------------ quiet hours */

/** Local hours [22:00, 08:00) are quiet: nothing is pushed to the device. */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;
/** A held alert older than this when the device wakes is dropped, not sent. */
export const HELD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const hourFormats = new Map<string, Intl.DateTimeFormat | null>();

/** The wall-clock hour (0-23) in `tz` at `now`, or null for an unusable zone. */
export function localHour(tz: string, now: Date): number | null {
  let f = hourFormats.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" });
    } catch {
      f = null;
    }
    hourFormats.set(tz, f);
  }
  if (!f) return null;
  const h = Number(f.formatToParts(now).find((p) => p.type === "hour")?.value);
  return Number.isInteger(h) ? h % 24 : null;
}

/**
 * Whether it is night for this device. No zone, or one this runtime cannot
 * read, is never quiet — that is exactly the behaviour every device had before
 * the app started sending one.
 */
export function inQuietHours(tz: string | null | undefined, now: Date): boolean {
  if (!tz) return false;
  const h = localHour(tz, now);
  if (h === null) return false;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/* ---------------------------------------------------------------- sending */

type Outcome = "ok" | "dead" | "retry";

/**
 * Send one alert per row, in order, and say what happened to each: delivered,
 * token dead (prune it), or a transient failure worth retrying next run.
 */
async function deliver(rows: PushRow[]): Promise<Outcome[]> {
  const out: Outcome[] = new Array(rows.length).fill("retry");
  const creds = loadCreds();

  /** The alert text, shared by every transport. */
  const contentFor = (r: PushRow): PushContent => {
    const m = buildMessage(r);
    return {
      title: m.title,
      body: m.body,
      productId: m.data.productId,
      kind: m.data.kind,
      pct: m.data.pct,
    };
  };

  // Route per token, not per run. Devices on the shipped build still hold
  // ExponentPushToken[…] and keep going through the relay; anything registering
  // a native token is sent to directly. That is what lets the installed base
  // rotate without a day where nobody gets notified.
  const viaExpo: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const kind = classifyToken(r.token);
    if (kind === "expo") {
      viaExpo.push(i);
      continue;
    }
    const creds_ok = kind === "apns" ? creds.apns : kind === "fcm" ? creds.fcm : null;
    // No credentials for that platform — retry next run rather than losing it.
    if (!creds_ok) continue;
    const res =
      kind === "apns"
        ? await sendApns(creds.apns!, r.token, contentFor(r))
        : await sendFcm(creds.fcm!, r.token, contentFor(r));
    out[i] = res.ok ? "ok" : res.dead ? "dead" : "retry";
  }

  for (const batch of chunk(viaExpo, 100)) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch.map((i) => buildMessage(rows[i]))),
    }).catch(() => null);
    if (!res?.ok) continue; // whole chunk stays "retry"
    const { data } = (await res.json().catch(() => ({}))) as { data?: Ticket[] };
    batch.forEach((rowIdx, i) => {
      const t = data?.[i];
      if (t?.status === "ok") out[rowIdx] = "ok";
      else if (t?.details?.error === "DeviceNotRegistered") out[rowIdx] = "dead";
      // anything else is transient (rate limit etc.) — retry next run
    });
  }
  return out;
}

export interface PushNotifyOpts {
  /** Test seam for quiet hours. */
  now?: Date;
}

/**
 * Push watchers about price drops on their tracked products, mirroring notify().
 * Marks push_notified_at for every pending price_drop event except those whose
 * send transiently failed (they retry next run). DeviceNotRegistered tokens are
 * pruned and their events marked (nothing to retry). Returns pushes sent.
 *
 * Quiet hours: a device whose local time (push_devices.tz) is 22:00-08:00 is
 * not sent to. Its (event, device) pair goes into push_held instead, and the
 * event is still marked as usual — every other watcher got it now, and the
 * mark is per EVENT, so leaving it unmarked would re-send to all of them. The
 * held pair is delivered on the first run after 08:00 local, or dropped if the
 * event is by then more than a day old. Devices with no tz are never held.
 */
export async function pushNotify(db: Db, opts: PushNotifyOpts = {}): Promise<number> {
  const now = opts.now ?? new Date();
  let sent = 0;
  const deadTokens = new Set<string>();

  // 1. Alerts held overnight whose device is awake now. First, so a device
  //    that just woke gets the older news before anything new.
  const held = await db.query<PushRow>(
    `SELECT w.token, w.target, e.id AS event_id, e.product_id, e.old_price, e.new_price, e.pct, p.name, p.brand, p.currency, w.size, e.type, d.lang, d.tz, e.ts AS event_ts
     FROM push_held h
     JOIN events e ON e.id = h.event_id
     JOIN push_devices d ON d.token = h.token
     JOIN push_watch w ON w.token = h.token AND w.product_id = e.product_id
     JOIN products p ON p.id = e.product_id`,
  );
  const awake = held.filter((r) => !inQuietHours(r.tz, now));
  const stale = awake.filter((r) => isStale(r, now));
  const dueHeld = awake.filter((r) => !isStale(r, now));
  const releasedHeld: PushRow[] = [...stale];
  if (dueHeld.length) {
    const outcomes = await deliver(dueHeld);
    dueHeld.forEach((r, i) => {
      if (outcomes[i] === "ok") sent++;
      if (outcomes[i] === "dead") deadTokens.add(r.token);
      if (outcomes[i] !== "retry") releasedHeld.push(r);
    });
  }
  if (releasedHeld.length) {
    await db.query(
      `DELETE FROM push_held h USING unnest($1::int[], $2::text[]) AS x(event_id, token)
       WHERE h.event_id = x.event_id AND h.token = x.token`,
      [releasedHeld.map((r) => r.event_id), releasedHeld.map((r) => r.token)],
    );
  }
  // Pairs whose watch was removed never match the join above. They are past
  // any use well before this — nothing is held longer than a night plus a day.
  await db.query(`DELETE FROM push_held WHERE held_at < now() - interval '2 days'`);

  // 2. New events.
  const rows = await db.query<PushRow>(
    // price_drop → any watcher of the product; back_in_stock → only the watcher
    // whose chosen size is the one that returned (e.size is set by the differ).
    // A pair already held is skipped: if another device's transient failure
    // kept the event unmarked, the held row — not this — delivers it here.
    `SELECT w.token, w.target, e.id AS event_id, e.product_id, e.old_price, e.new_price, e.pct, p.name, p.brand, p.currency, w.size, e.type, d.lang, d.tz, e.ts AS event_ts
     FROM events e
     JOIN push_watch w ON w.product_id = e.product_id
       AND ( (e.type = 'price_drop' AND (w.target IS NULL OR e.new_price <= w.target))
          OR (e.type = 'back_in_stock' AND e.size IS NOT NULL AND w.size = e.size) )
     JOIN products p ON p.id = e.product_id
     LEFT JOIN push_devices d ON d.token = w.token
     WHERE e.type IN ('price_drop','back_in_stock') AND e.push_notified_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM push_held h WHERE h.event_id = e.id AND h.token = w.token)`,
  );

  const failedEventIds = new Set<number>();
  const hold = rows.filter((r) => inQuietHours(r.tz, now));
  const due = rows.filter((r) => !inQuietHours(r.tz, now));

  if (hold.length) {
    await db.query(
      `INSERT INTO push_held (event_id, token)
       SELECT x.event_id, x.token FROM unnest($1::int[], $2::text[]) AS x(event_id, token)
       ON CONFLICT DO NOTHING`,
      [hold.map((r) => r.event_id), hold.map((r) => r.token)],
    );
  }

  const outcomes = await deliver(due);
  due.forEach((r, i) => {
    if (outcomes[i] === "ok") sent++;
    else if (outcomes[i] === "dead") deadTokens.add(r.token);
    else failedEventIds.add(r.event_id);
  });

  if (deadTokens.size) {
    await db.query(`DELETE FROM push_devices WHERE token = ANY($1)`, [[...deadTokens]]);
  }
  // Mark everything pending except transient failures — including events with no
  // watchers at all, so the backlog stays clean, and events held for a sleeping
  // device (push_held owns those pairs now). Size back_in_stock events are
  // marked too; product-level (size null) back_in_stock is left alone (unnotified).
  await db.query(
    `UPDATE events SET push_notified_at = now()
     WHERE push_notified_at IS NULL AND NOT (id = ANY($1))
       AND (type = 'price_drop' OR (type = 'back_in_stock' AND size IS NOT NULL))`,
    [[...failedEventIds]],
  );

  if (rows.length || held.length) {
    console.log(
      `push: sent ${sent}/${due.length + dueHeld.length} notifications ` +
        `(${hold.length} held for quiet hours, ${stale.length} stale held dropped, ${deadTokens.size} dead tokens pruned)`,
    );
  }
  return sent;
}

function isStale(r: PushRow, now: Date): boolean {
  if (r.event_ts == null) return false;
  const t = new Date(r.event_ts).getTime();
  return Number.isFinite(t) && now.getTime() - t > HELD_MAX_AGE_MS;
}
