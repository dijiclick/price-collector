/**
 * The heartbeat: the one signal that says the self-hosted collector is alive.
 *
 * GitHub Actions gave us a run list for free — a missed sweep was visible in a
 * web UI somebody might look at. A systemd timer on a single box gives us
 * nothing: if the unit fails, or the timer is masked, or the box reboots into a
 * broken state, the collector simply stops and the app keeps looking fine while
 * sending no alerts at all. Silence is the dangerous state.
 *
 * So every SUCCESSFUL run overwrites one small JSON file, and a separate
 * watchdog timer reads it. A file (not a database row) on purpose: the most
 * likely reason the collector stops is that it cannot reach Postgres, and a
 * health signal that needs the thing it is monitoring reports nothing on the
 * day it matters.
 *
 * Everything here is pure and side-effect free apart from the two fs helpers at
 * the bottom, so the staleness rules are unit-testable without a clock or a box.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Heartbeat {
  /** ISO 8601, when the run started. */
  startedAt: string;
  /** ISO 8601, when it finished successfully. Absent for a failed run. */
  finishedAt: string;
  /** Wall clock, seconds. The watchdog's staleness budget is derived from it. */
  durationSec: number;
  /** What the run swept: "all", or the ONLY_BRANDS/SKIP_BRANDS filter. */
  scope: string;
  /** Deploy stamp of the tree that ran, so a stuck old version is visible. */
  revision: string;
  /** Which machine wrote it. Guards against reading a stale rsync'd copy. */
  host: string;
}

export interface Staleness {
  stale: boolean;
  /** Milliseconds since the last successful run, or null when never. */
  ageMs: number | null;
  /** Human sentence for the alert email. Empty when healthy. */
  reason: string;
}

/**
 * Parse tolerantly and NEVER throw.
 *
 * A watchdog that crashes on a truncated file is a watchdog that stays quiet
 * exactly when something is wrong — a half-written heartbeat is itself evidence
 * of a crash mid-write, so it must read as "no heartbeat", not as an exception.
 */
export function parseHeartbeat(text: string | null | undefined): Heartbeat | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const finishedAt = typeof o.finishedAt === "string" ? o.finishedAt : "";
  // A heartbeat with an unparseable timestamp is worse than none: it would read
  // as NaN age and compare false against every threshold, i.e. always healthy.
  if (!finishedAt || Number.isNaN(Date.parse(finishedAt))) return null;
  return {
    startedAt: typeof o.startedAt === "string" ? o.startedAt : finishedAt,
    finishedAt,
    durationSec: typeof o.durationSec === "number" && Number.isFinite(o.durationSec) ? o.durationSec : 0,
    scope: typeof o.scope === "string" ? o.scope : "unknown",
    revision: typeof o.revision === "string" ? o.revision : "unknown",
    host: typeof o.host === "string" ? o.host : "unknown",
  };
}

/**
 * Is the collector late?
 *
 * `maxAgeMs` is the alert budget, not the cadence: a 30-minute timer whose runs
 * take ~7 minutes is healthy at 40 minutes old and suspicious at 90. Missing or
 * unreadable heartbeat is STALE — this fails closed, because "I cannot tell"
 * and "it is broken" need the same response.
 */
export function checkStale(hb: Heartbeat | null, now: Date, maxAgeMs: number): Staleness {
  if (!hb) {
    return { stale: true, ageMs: null, reason: "no successful collector run has ever been recorded on this host" };
  }
  const ageMs = now.getTime() - Date.parse(hb.finishedAt);
  if (ageMs < 0) {
    // Clock went backwards (ntp step, or a heartbeat copied from elsewhere).
    // Treat as healthy-but-odd rather than alerting on every tick.
    return { stale: false, ageMs, reason: "" };
  }
  if (ageMs > maxAgeMs) {
    return {
      stale: true,
      ageMs,
      reason:
        `last successful collector run finished ${Math.round(ageMs / 60000)} min ago ` +
        `(budget ${Math.round(maxAgeMs / 60000)} min), scope "${hb.scope}", revision ${hb.revision}`,
    };
  }
  return { stale: false, ageMs, reason: "" };
}

/**
 * Write atomically: a heartbeat is read by another process on a timer, and a
 * partial write is indistinguishable from a crash. Rename is atomic within a
 * filesystem, `writeFileSync` on the real path is not.
 */
export function writeHeartbeat(path: string, hb: Heartbeat): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(hb, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  renameSync(tmp, path);
}

export function readHeartbeat(path: string): Heartbeat | null {
  try {
    return parseHeartbeat(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
