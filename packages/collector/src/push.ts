import type { Db } from "./db";
import { fromMinorTRY } from "./normalize";
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
 * Prices stay in lira either way, because they ARE lira; only the separators
 * follow the language, which is why the percentage and the arrow are built here
 * rather than inline.
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
  const drop = `${fromMinorTRY(r.old_price, r.lang)} → ${fromMinorTRY(r.new_price, r.lang)} (${c.pct(Math.abs(r.pct))})`;
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

/**
 * Push watchers about price drops on their tracked products, mirroring notify().
 * Marks push_notified_at for every pending price_drop event except those whose
 * send transiently failed (they retry next run). DeviceNotRegistered tokens are
 * pruned and their events marked (nothing to retry). Returns pushes sent.
 */
export async function pushNotify(db: Db): Promise<number> {
  const rows = await db.query<PushRow>(
    // price_drop → any watcher of the product; back_in_stock → only the watcher
    // whose chosen size is the one that returned (e.size is set by the differ).
    `SELECT w.token, w.target, e.id AS event_id, e.product_id, e.old_price, e.new_price, e.pct, p.name, p.brand, w.size, e.type, d.lang
     FROM events e
     JOIN push_watch w ON w.product_id = e.product_id
       AND ( (e.type = 'price_drop' AND (w.target IS NULL OR e.new_price <= w.target))
          OR (e.type = 'back_in_stock' AND e.size IS NOT NULL AND w.size = e.size) )
     JOIN products p ON p.id = e.product_id
     LEFT JOIN push_devices d ON d.token = w.token
     WHERE e.type IN ('price_drop','back_in_stock') AND e.push_notified_at IS NULL`,
  );

  let sent = 0;
  const failedEventIds = new Set<number>();
  const deadTokens = new Set<string>();

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
  const direct = rows.filter((r) => classifyToken(r.token) !== "expo");
  const viaExpo = rows.filter((r) => classifyToken(r.token) === "expo");

  for (const r of direct) {
    const kind = classifyToken(r.token);
    const creds_ok = kind === "apns" ? creds.apns : kind === "fcm" ? creds.fcm : null;
    if (!creds_ok) {
      // No credentials for that platform — retry next run rather than losing it.
      failedEventIds.add(r.event_id);
      continue;
    }
    const res =
      kind === "apns"
        ? await sendApns(creds.apns!, r.token, contentFor(r))
        : await sendFcm(creds.fcm!, r.token, contentFor(r));
    if (res.ok) sent++;
    else if (res.dead) deadTokens.add(r.token);
    else failedEventIds.add(r.event_id);
  }

  const batches = chunk(viaExpo, 100);
  for (const batch of batches) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch.map(buildMessage)),
    }).catch(() => null);
    if (!res?.ok) {
      for (const r of batch) failedEventIds.add(r.event_id);
      continue;
    }
    const { data } = (await res.json().catch(() => ({}))) as { data?: Ticket[] };
    batch.forEach((r, i) => {
      const t = data?.[i];
      if (t?.status === "ok") sent++;
      else if (t?.details?.error === "DeviceNotRegistered") deadTokens.add(r.token);
      else failedEventIds.add(r.event_id); // transient (rate limit etc.) — retry next run
    });
  }

  if (deadTokens.size) {
    await db.query(`DELETE FROM push_devices WHERE token = ANY($1)`, [[...deadTokens]]);
  }
  // Mark everything pending except transient failures — including events with no
  // watchers at all, so the backlog stays clean. Size back_in_stock events are
  // marked too; product-level (size null) back_in_stock is left alone (unnotified).
  await db.query(
    `UPDATE events SET push_notified_at = now()
     WHERE push_notified_at IS NULL AND NOT (id = ANY($1))
       AND (type = 'price_drop' OR (type = 'back_in_stock' AND size IS NOT NULL))`,
    [[...failedEventIds]],
  );

  if (rows.length) console.log(`push: sent ${sent}/${rows.length} notifications (${deadTokens.size} dead tokens pruned)`);
  return sent;
}
