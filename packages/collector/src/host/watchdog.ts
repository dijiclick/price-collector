/**
 * The fail-safe. One box is a single point of failure where GitHub Actions was
 * not, so the box has to be able to report its own death.
 *
 * A second systemd timer runs this every few minutes. It reads the heartbeat
 * that a successful sweep writes and emails when the collector has gone quiet —
 * deliberately NOT through the collector's own notifier, because the failure
 * being reported is usually "the collector cannot run", and a monitor that
 * shares a code path with the thing it monitors reports nothing on the day it
 * matters. This file imports only the heartbeat reader and `fetch`.
 *
 * It re-alerts on a schedule rather than every tick (nobody reads 96 identical
 * emails a day) and sends one RESOLVED mail when a sweep succeeds again, so an
 * unresolved thread in the inbox always means still broken.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { checkStale, readHeartbeat, type Staleness } from "./heartbeat";

/** The collector runs every 30 min and takes ~7. Three missed sweeps is late. */
export const DEFAULT_MAX_AGE_MIN = 95;
/** Don't re-send the same bad news more than once every few hours. */
export const DEFAULT_REALERT_MIN = 360;

export interface WatchdogState {
  /** ISO time of the last alert email, or "" when the last known state was healthy. */
  lastAlertAt: string;
}

export type AlertAction =
  | { kind: "none"; reason: string }
  | { kind: "alert"; subject: string; body: string }
  | { kind: "recovery"; subject: string; body: string };

/**
 * The whole decision, as a pure function: stale or not, have we already said so,
 * and was it long enough ago to say it again.
 */
export function alertDecision(
  staleness: Staleness,
  state: WatchdogState,
  now: Date,
  realertMs: number,
  host: string,
): AlertAction {
  const alerting = state.lastAlertAt !== "" && !Number.isNaN(Date.parse(state.lastAlertAt));

  if (!staleness.stale) {
    if (!alerting) return { kind: "none", reason: "healthy" };
    return {
      kind: "recovery",
      subject: `[modadrop] collector RECOVERED on ${host}`,
      body:
        `The self-hosted collector on ${host} has completed a sweep again.\n\n` +
        `Last successful run: ${staleness.ageMs === null ? "unknown" : `${Math.round(staleness.ageMs / 60000)} min ago`}\n` +
        `Alerting since: ${state.lastAlertAt}\n`,
    };
  }

  if (alerting && now.getTime() - Date.parse(state.lastAlertAt) < realertMs) {
    return { kind: "none", reason: "already alerted recently" };
  }

  return {
    kind: "alert",
    subject: `[modadrop] COLLECTOR SILENT on ${host}`,
    body:
      `The self-hosted collector on ${host} has not completed a successful sweep.\n\n` +
      `${staleness.reason}\n\n` +
      `No sweep means no price-drop pushes and no email digests — users see an\n` +
      `alert app that sends no alerts.\n\n` +
      `Check:   systemctl status modadrop-collect.service modadrop-collect.timer\n` +
      `Logs:    journalctl -u modadrop-collect.service -n 200 --no-pager\n` +
      `Fallback: re-enable the GitHub Actions schedule —\n` +
      `         gh workflow enable collect.yml --repo dijiclick/price-collector\n` +
      `         then stop this one: systemctl disable --now modadrop-collect.timer\n` +
      `(docs/collector-self-hosted.md has the full rollback.)\n`,
  };
}

export function readState(path: string): WatchdogState {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return { lastAlertAt: typeof raw.lastAlertAt === "string" ? raw.lastAlertAt : "" };
  } catch {
    return { lastAlertAt: "" };
  }
}

export function writeState(path: string, state: WatchdogState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state)}\n`, "utf8");
  renameSync(tmp, path);
}

/**
 * Resend, by hand. Ten lines and no shared state with the collector's notifier
 * — see the file header for why that separation is deliberate.
 */
async function sendAlert(env: NodeJS.ProcessEnv, subject: string, body: string): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  const to = env.MODADROP_ALERT_EMAIL;
  if (!key || !to) {
    console.error(`cannot send: ${!key ? "RESEND_API_KEY" : "MODADROP_ALERT_EMAIL"} is not set`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM ?? "Modadrop <onboarding@resend.dev>",
      to: [to],
      subject,
      text: body,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    // Status only. A Resend error body can echo the request, and this goes to a journal.
    console.error(`resend refused the alert: HTTP ${res.status}`);
    return false;
  }
  return true;
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const dir = env.MODADROP_STATE_DIR ?? "/var/lib/modadrop";
  const now = new Date();
  const maxAgeMs = Number(env.MODADROP_MAX_AGE_MIN ?? DEFAULT_MAX_AGE_MIN) * 60000;
  const realertMs = Number(env.MODADROP_REALERT_MIN ?? DEFAULT_REALERT_MIN) * 60000;
  const statePath = resolve(dir, "watchdog.json");

  const staleness = checkStale(readHeartbeat(resolve(dir, "heartbeat.json")), now, maxAgeMs);
  const state = readState(statePath);
  const action = alertDecision(staleness, state, now, realertMs, hostname());

  if (action.kind === "none") {
    console.log(`watchdog: ${action.reason} (age ${staleness.ageMs === null ? "never" : `${Math.round(staleness.ageMs / 60000)}min`})`);
    return 0;
  }

  const sent = await sendAlert(env, action.subject, action.body);
  console.log(`watchdog: ${action.kind} — ${sent ? "emailed" : "EMAIL FAILED"} — ${action.subject}`);
  // Record the state change even when the mail failed, otherwise a broken
  // Resend key turns into an email attempt every single tick.
  writeState(statePath, { lastAlertAt: action.kind === "alert" ? now.toISOString() : "" });
  // Non-zero when we could not get the message out, so `systemctl --failed`
  // and the journal still carry the fact.
  return sent ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
