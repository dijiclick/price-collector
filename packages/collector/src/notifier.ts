import type { Db } from "./db";
import { fromMinorTRY } from "./normalize";
// Shared with the web app rather than duplicated: this list was hand-maintained
// here and had already drifted — Boyner and Beymen were missing, so their alert
// emails would have shown the raw slug as the brand name.
import { BRAND_LABELS } from "../../../lib/format";
import { canSign, unsubscribePostUrl, unsubscribeUrl } from "../../../lib/unsubscribe";

export interface DropRow {
  email: string;
  name: string;
  brand: string;
  url: string;
  event_id: number;
  old_price: number;
  new_price: number;
  pct: number;
  size: string | null;
  type: "price_drop" | "back_in_stock";
  target: number | null;
  /** null for anyone who subscribed before the language setting existed. */
  lang: "tr" | "en" | null;
}

/**
 * Alert-email copy, per language. Same rule as the push copy: the prices stay
 * lira, only the separators and the words follow the reader.
 */
const COPY = {
  tr: {
    size: (s: string) => `Beden ${s}`,
    restock: (s: string | null) => (s ? `Beden ${s} tekrar stokta 🎉` : "Tekrar stokta 🎉"),
    hitTarget: "🎯 Hedefine ulaştı",
    pct: (n: number) => `−%${n}`,
    headingBack: "Takip ettiğin ürünler tekrar stokta 🎉",
    heading: "Takip listenden haberler 🎉",
    footer: "Modadrop · fiyat alarmı. Bu bildirimi takip listene eklediğin için aldın.",
    unsubscribe: "Aboneliği kaldır",
    subjectBack: (n: number) => `${n} takip ettiğin ürün tekrar stokta`,
    subject: (n: number) => `${n} takip ettiğin ürün için haber var`,
  },
  en: {
    size: (s: string) => `Size ${s}`,
    restock: (s: string | null) => (s ? `Size ${s} is back in stock 🎉` : "Back in stock 🎉"),
    hitTarget: "🎯 Target reached",
    pct: (n: number) => `−${n}%`,
    headingBack: "What you're tracking is back in stock 🎉",
    heading: "News from your tracked list 🎉",
    footer: "Modadrop · price alerts. You're getting this because you tracked these products.",
    unsubscribe: "Unsubscribe",
    subjectBack: (n: number) =>
      `${n} product${n === 1 ? "" : "s"} you track ${n === 1 ? "is" : "are"} back in stock`,
    subject: (n: number) => `News on ${n} product${n === 1 ? "" : "s"} you track`,
  },
};

const copyFor = (lang: DropRow["lang"]) => COPY[lang ?? "tr"] ?? COPY.tr;

/**
 * Everything interpolated below is SCRAPED, so none of it can be trusted as
 * markup. 2.836 live product names carry `<`, `>`, `"` or `&` — "Head &
 * Shoulders", "rom&nd", "Lip & Cheek" — and they were going into the HTML raw,
 * including into an href attribute.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An href we are willing to put in someone's inbox: http(s) only, escaped. */
export function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? esc(url) : "#";
}

/**
 * A drop is only worth an email while it is still true.
 *
 * The notifier sat dormant for weeks, so the pending queue reaches 28 days back
 * and half of it has since moved: one row would have announced a fall to ₺10,00
 * on a product now selling for ₺89,00. Age alone is not the test — the price
 * is — but a stale-dated alert is unwelcome even when it still holds, so both
 * apply.
 */
export const MAX_ALERT_AGE_MS = 24 * 60 * 60 * 1000;

export function stillTrue(r: DropRow & { current_price: number; in_stock: boolean; ts: string | Date }, now: Date): boolean {
  if (now.getTime() - new Date(r.ts).getTime() > MAX_ALERT_AGE_MS) return false;
  return r.type === "back_in_stock" ? r.in_stock : r.new_price === r.current_price;
}

function itemHtml(i: DropRow): string {
  const c = copyFor(i.lang);
  const head = `
        <td style="padding:10px 0;border-bottom:1px solid #e9e5e0">
          <div style="font-size:12px;color:#8c1d2f;font-weight:700;text-transform:uppercase">${esc(BRAND_LABELS[i.brand] ?? i.brand)}</div>
          <a href="${safeHref(i.url)}" style="color:#17141a;font-weight:600;text-decoration:none">${esc(i.name)}</a>
          ${i.size ? `<div style="font-size:12px;color:#6f6a75;margin-top:2px">${esc(c.size(i.size))}</div>` : ""}`;
  if (i.type === "back_in_stock") {
    return `<tr>${head}
          <div style="margin-top:4px">
            <span style="color:#2e6b4f;font-weight:700;font-size:14px">${esc(c.restock(i.size))}</span>
          </div>
        </td>
      </tr>`;
  }
  const hitTarget = i.target != null && i.new_price <= i.target;
  return `<tr>${head}
          <div style="margin-top:4px">
            <span style="font-weight:800;font-size:17px">${fromMinorTRY(i.new_price, i.lang)}</span>
            <span style="color:#857f8b;text-decoration:line-through;margin-left:8px">${fromMinorTRY(i.old_price, i.lang)}</span>
            <span style="color:#fff;background:#8c1d2f;border-radius:8px;padding:2px 7px;font-weight:700;font-size:12px;margin-left:8px">${c.pct(Math.abs(i.pct))}</span>
          </div>
          ${hitTarget ? `<div style="font-size:12px;color:#2e6b4f;font-weight:700;margin-top:3px">${c.hitTarget}</div>` : ""}
        </td>
      </tr>`;
}

const SITE = process.env.EXPO_PUBLIC_API_URL ?? "https://modadrop.vercel.app";

/** Exported for its test — the language selection is the part with a decision in it. */
export function emailHtml(items: DropRow[], unsubUrl: string): string {
  // Every item in one email belongs to one subscriber, so the first row's
  // language is the whole email's.
  const c = copyFor(items[0]?.lang ?? null);
  const rows = items.map(itemHtml).join("");
  const allBack = items.every((i) => i.type === "back_in_stock");
  const heading = allBack ? c.headingBack : c.heading;
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17141a">
    <h2 style="font-size:20px">${heading}</h2>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#6f6a75;font-size:12px;margin-top:20px">
      ${c.footer}<br>
      <a href="${unsubUrl}" style="color:#6f6a75">${c.unsubscribe}</a>
    </p>
  </div>`;
}

async function send(key: string, to: string, items: DropRow[]): Promise<boolean> {
  const unsubUrl = unsubscribeUrl(to, SITE);
  const unsubPost = unsubscribePostUrl(to, SITE);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Modadrop <onboarding@resend.dev>",
      to,
      subject: items.every((i) => i.type === "back_in_stock")
        ? copyFor(items[0]?.lang ?? null).subjectBack(items.length)
        : copyFor(items[0]?.lang ?? null).subject(items.length),
      html: emailHtml(items, unsubUrl),
      // The mail client's own unsubscribe button, per RFC 8058. Without
      // List-Unsubscribe-Post a client shows nothing; with it, Gmail and Apple
      // Mail put "Unsubscribe" next to the sender and POST to the URL. A footer
      // link alone is a link people have to find.
      headers: {
        "List-Unsubscribe": `<${unsubPost}>, <mailto:support@raizeka.com?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  }).catch(() => null);
  return !!res?.ok;
}

/** Email watchers about price drops on their watched products. Returns emails sent. */
export async function notify(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db.query<DropRow & { current_price: number; in_stock: boolean; ts: string }>(
    // price_drop → watchers with no target, or whose target the new price has met;
    // back_in_stock → only the watcher whose chosen size is the one that returned.
    // `current_price`/`in_stock`/`ts` come along so `stillTrue` can retire an
    // alert the world has moved past instead of emailing it.
    `SELECT w.email, p.name, p.brand, p.url, e.id AS event_id, e.old_price, e.new_price, e.pct,
            w.size, e.type, w.target, e.ts, p.current_price, p.in_stock, sub.lang
     FROM events e
     JOIN watchlist w ON w.product_id = e.product_id
       AND ( (e.type = 'price_drop' AND (w.target IS NULL OR e.new_price <= w.target))
          OR (e.type = 'back_in_stock' AND e.size IS NOT NULL AND w.size = e.size) )
     JOIN products p ON p.id = e.product_id
     LEFT JOIN subscribers sub ON sub.email = w.email
     WHERE e.type IN ('price_drop','back_in_stock') AND e.notified_at IS NULL`,
  );

  // No unsubscribe link means no send. A price alert someone cannot get out of
  // is worse than a price alert they never received, and /gizlilik promises the
  // link by name.
  if (!canSign()) {
    if (rows.length) {
      console.log("notifier: UNSUBSCRIBE_SECRET not set — refusing to send without a working unsubscribe link");
    }
    return 0;
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Nothing is marked while dormant, deliberately: a run that cannot send must
    // not consume the queue, or switching the key on would start from silence.
    const waiting = new Set(rows.map((r) => r.email)).size;
    console.log(`notifier: ${waiting} watcher email(s) pending — RESEND_API_KEY not set, not sending`);
    return 0;
  }

  const fresh = rows.filter((r) => stillTrue(r, now));
  const staleIds = rows.filter((r) => !stillTrue(r, now)).map((r) => r.event_id);

  const byEmail = new Map<string, DropRow[]>();
  for (const r of fresh) {
    if (!byEmail.has(r.email)) byEmail.set(r.email, []);
    byEmail.get(r.email)!.push(r);
  }

  let sent = 0;
  const failedIds = new Set<number>();
  for (const [email, items] of byEmail) {
    if (await send(key, email, items)) sent++;
    else for (const i of items) failedIds.add(i.event_id); // transient — retry next run
  }

  // Mark everything pending EXCEPT the transient failures — including the stale
  // ones we chose not to send and the events nobody watches at all. Without this
  // the backlog only ever grows: all 815.890 events in the table are currently
  // unmarked, and every run re-scans the lot to find the handful that matter.
  await db.query(
    `UPDATE events SET notified_at = now()
     WHERE notified_at IS NULL AND NOT (id = ANY($1))
       AND type IN ('price_drop','back_in_stock')`,
    [[...failedIds]],
  );

  console.log(
    `notifier: sent ${sent}/${byEmail.size} watcher emails` +
      (staleIds.length ? ` (${staleIds.length} stale alert(s) retired unsent)` : ""),
  );
  return sent;
}
