/**
 * Day-3 reminder.
 *
 * Most people who installed from the 23-25 Sep 2026 ads tracked something, got
 * no alert (nothing they tracked had moved yet) and never came back — the app
 * gave them no reason to. One reminder, 3-10 days after install, to devices that
 * track at least one product and have never had an alert, tells them the watch is
 * running and brings them back to the feed.
 *
 * - Exactly once per device (push_devices.reminded_at).
 * - Only native APNs/FCM tokens: old Expo-relay builds are left alone.
 * - Quiet hours delay it to a later run; a device that muted every alert kind
 *   is never reminded.
 * - Tapping it opens one of the tracked products (the app treats an unknown
 *   `kind` as a plain drop in the foreground and opens the product page).
 */
import type { Db } from "./db";
import { devicePrefs, inQuietHours } from "./push";
import { classifyToken, loadCreds, sendApns, sendFcm, type PushContent } from "./push-transport";

type Outcome = "ok" | "dead" | "retry";
export type ReminderSend = (token: string, c: PushContent) => Promise<Outcome>;

export function buildReminder(lang: string | null, n: number): { title: string; body: string } {
  if (lang === "en") {
    return {
      title: "Still watching for you 👀",
      body: `We're watching your ${n} ${n === 1 ? "item" : "items"}: you'll hear when the price drops or your size is back. Meanwhile, see today's deals.`,
    };
  }
  return {
    title: "Takibin sürüyor 👀",
    body: `${n} ürününü izliyoruz: fiyatı düşünce ya da bedenin gelince haber vereceğiz. Bu arada bugünkü indirimlere göz at.`,
  };
}

interface Row {
  token: string;
  lang: string | null;
  tz: string | null;
  prefs: unknown;
  n: number;
  product_id: number;
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

export async function pushReminders(
  db: Db,
  opts: { now?: Date; send?: ReminderSend } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? realSend;
  const rows = await db.query<Row>(
    `SELECT d.token, d.lang, d.tz, d.prefs, count(*)::int AS n, min(w.product_id)::int AS product_id
     FROM push_devices d
     JOIN push_watch w ON w.token = d.token
     WHERE d.reminded_at IS NULL
       AND d.created_at <= $1::timestamptz - interval '3 days'
       AND d.created_at >  $1::timestamptz - interval '10 days'
       AND NOT EXISTS (
         SELECT 1 FROM push_watch w2 JOIN events e ON e.product_id = w2.product_id
         WHERE w2.token = d.token AND e.push_notified_at IS NOT NULL
           AND e.push_notified_at > d.created_at
           AND e.type IN ('price_drop','back_in_stock'))
     GROUP BY d.token, d.lang, d.tz, d.prefs`,
    [now.toISOString()],
  );

  let sent = 0;
  const done: string[] = [];
  const dead: string[] = [];
  for (const r of rows) {
    if (classifyToken(r.token) === "expo") continue;
    const prefs = devicePrefs(r.prefs);
    if (prefs && !prefs.drop && !prefs.target && !prefs.restock) {
      done.push(r.token); // opted out of every alert: never remind
      continue;
    }
    if (inQuietHours(r.tz, now, prefs)) continue; // try again next run
    const m = buildReminder(r.lang, r.n);
    const out = await send(r.token, { title: m.title, body: m.body, productId: r.product_id, kind: "drop" });
    if (out === "ok") {
      sent++;
      done.push(r.token);
    } else if (out === "dead") dead.push(r.token);
  }
  if (done.length) await db.query(`UPDATE push_devices SET reminded_at = $2 WHERE token = ANY($1)`, [done, now.toISOString()]);
  if (dead.length) await db.query(`DELETE FROM push_devices WHERE token = ANY($1)`, [dead]);
  if (rows.length) console.log(`push reminders: sent ${sent}/${rows.length} (${dead.length} dead tokens pruned)`);
  return sent;
}
