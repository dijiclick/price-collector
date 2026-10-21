/**
 * The push log and the nudge budget (owner 2026-10-21: "don't send every day —
 * every 2 days").
 *
 * Every push sent is logged (push_log), and the app reports when one is opened
 * (app/api/push/opened marks the device's latest push). Two classes:
 *
 *   personal  the shopper's own item, size, target or alarm — never capped here
 *   nudge     the app reaching out unasked: round-up, sale start, calendar,
 *             remembered searches, the day-3 reminder, the first-week series
 *
 * Nudges share ONE budget per device: at least 48 h apart; 96 h once the last
 * five were all ignored; none at all after 30 days with six or more nudges and
 * not a single open. That is the back-off — someone who never taps should stop
 * hearing from us long before they switch notifications off.
 */
import type { Db } from "./db";

export const NUDGE_GAP_MS = 48 * 3600_000;
export const IGNORED_GAP_MS = 96 * 3600_000;

export interface NudgeStats {
  lastNudge: Date | null;
  /** The last (up to) five nudges, and how many of them were never opened. */
  recent: number;
  recentUnopened: number;
  /** Last 30 days: nudges sent, and pushes of any kind opened. */
  nudges30: number;
  opens30: number;
}

export function nudgeOk(s: NudgeStats, now: Date): boolean {
  if (s.nudges30 >= 6 && s.opens30 === 0) return false;
  const gap = s.recent >= 5 && s.recentUnopened >= 5 ? IGNORED_GAP_MS : NUDGE_GAP_MS;
  return !s.lastNudge || now.getTime() - s.lastNudge.getTime() >= gap;
}

const asDate = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v : new Date(v));

/**
 * Which of these devices may get a nudge now. Also counts the nudges sent
 * before the log existed (push_news), so the switch-over day is not a free-for-all.
 */
export async function nudgeAllowed(db: Db, tokens: string[], now: Date): Promise<Set<string>> {
  const ok = new Set<string>();
  if (!tokens.length) return ok;
  const rows = await db.query<{ token: string; last_nudge: Date | string | null; recent: number; recent_unopened: number; nudges30: number; opens30: number }>(
    `SELECT t.token,
            GREATEST((SELECT max(sent_at) FROM push_log l WHERE l.token = t.token AND l.nudge),
                     (SELECT max(sent_at) FROM push_news n WHERE n.token = t.token)) AS last_nudge,
            (SELECT count(*)::int FROM (SELECT 1 FROM push_log l WHERE l.token = t.token AND l.nudge ORDER BY sent_at DESC LIMIT 5) x) AS recent,
            (SELECT count(*)::int FROM (SELECT opened_at FROM push_log l WHERE l.token = t.token AND l.nudge ORDER BY sent_at DESC LIMIT 5) x WHERE x.opened_at IS NULL) AS recent_unopened,
            (SELECT count(*)::int FROM push_log l WHERE l.token = t.token AND l.nudge AND l.sent_at > $2::timestamptz - interval '30 days') AS nudges30,
            (SELECT count(*)::int FROM push_log l WHERE l.token = t.token AND l.opened_at > $2::timestamptz - interval '30 days') AS opens30
       FROM unnest($1::text[]) AS t(token)`,
    [tokens, now.toISOString()],
  );
  for (const r of rows) {
    if (nudgeOk({ lastNudge: asDate(r.last_nudge), recent: r.recent, recentUnopened: r.recent_unopened, nudges30: r.nudges30, opens30: r.opens30 }, now)) ok.add(r.token);
  }
  return ok;
}

export interface LoggedPush { token: string; kind: string; nudge: boolean; key?: string | null; productId?: number | null }

/** Record sent pushes. Never throws: a logging hiccup must not stop delivery. */
export async function logPushes(db: Db, items: LoggedPush[], now: Date = new Date()): Promise<void> {
  if (!items.length) return;
  try {
    await db.query(
      `INSERT INTO push_log (token, kind, nudge, key, product_id, sent_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::bool[], $4::text[], $5::bigint[], $6::timestamptz[])`,
      [items.map((i) => i.token), items.map((i) => i.kind), items.map((i) => i.nudge), items.map((i) => i.key ?? null),
        items.map((i) => i.productId ?? null), items.map(() => now.toISOString())],
    );
  } catch (err) {
    console.error("push log failed:", err instanceof Error ? err.message : err);
  }
}
