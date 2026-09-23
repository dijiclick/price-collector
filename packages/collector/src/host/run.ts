/**
 * The self-hosted collector's entry point. `systemd` runs THIS, never
 * `collect.ts` directly.
 *
 * It exists because a systemd timer is a dumber scheduler than GitHub Actions:
 * Actions gave us a concurrency group, a visible run history, and a secrets
 * store that fails the job when a name is wrong. A timer gives us none of that,
 * so the three things it would otherwise silently get wrong happen here, before
 * the collector starts:
 *
 *   1. env validation      — a missing RESEND_API_KEY collects fine and tells
 *                            nobody anything. Refuse or warn, loudly.
 *   2. a concurrency guard — two overlapping sweeps double-send every push.
 *   3. a heartbeat         — the only way anything notices the box went quiet.
 *
 * Exit codes are the systemd contract: 0 ran (or deliberately skipped), 78
 * (EX_CONFIG) is a bad environment, anything else is the collector's own
 * failure passed straight through.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeEnv, validateEnv } from "./env";
import { writeHeartbeat, type Heartbeat } from "./heartbeat";
import { DEFAULT_MAX_HOLD_MS, acquireLock, releaseLock } from "./lock";

const EX_CONFIG = 78;

/** Where run state lives. Deliberately outside the deploy tree, which rsync wipes. */
export const stateDir = (env: NodeJS.ProcessEnv = process.env): string =>
  env.MODADROP_STATE_DIR ?? "/var/lib/modadrop";

/**
 * A one-line description of what this tick swept, stored in the heartbeat so a
 * stale one says *which* schedule stopped — the Turkey sweep and a future
 * international sweep will both write heartbeats.
 */
export function describeScope(env: NodeJS.ProcessEnv): string {
  const parts: string[] = [];
  if (env.ONLY_BRANDS) parts.push(`only=${env.ONLY_BRANDS}`);
  if (env.SKIP_BRANDS) parts.push(`skip=${env.SKIP_BRANDS}`);
  if (env.COUNTRIES) parts.push(`countries=${env.COUNTRIES}`);
  return parts.length ? parts.join(" ") : "all";
}

/**
 * What to actually execute. Overridable so the tests can drive the real
 * lock/heartbeat/exit-code paths with a stub instead of a 7-minute sweep.
 */
export function collectCommand(env: NodeJS.ProcessEnv): string[] {
  if (env.MODADROP_COLLECT_CMD) return env.MODADROP_COLLECT_CMD.split(" ").filter(Boolean);
  return [resolve(deployRoot(), "node_modules/.bin/tsx"), resolve(deployRoot(), "packages/collector/src/collect.ts")];
}

/** host/ -> src/ -> collector/ -> packages/ -> the deploy root. */
const deployRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Which tree is running. `deploy.sh` writes REVISION at the root, so a stale
 * heartbeat says whether the box is stuck on an old deploy or simply not
 * running — two very different problems that look identical otherwise.
 */
export function revision(env: NodeJS.ProcessEnv): string {
  if (env.MODADROP_REVISION) return env.MODADROP_REVISION;
  try {
    return readFileSync(resolve(deployRoot(), "REVISION"), "utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The external dead-man's switch, kept from the GitHub workflow.
 *
 * The box's own watchdog cannot report that the BOX is dead — that is the one
 * failure a single machine structurally cannot alert on, and it is the whole
 * risk of moving off GitHub. A third party (healthchecks.io or similar) that
 * expects a ping every 30 minutes covers it. Success pings the URL, failure
 * pings `<url>/fail`, exactly as `collect.yml` does, so the same check works
 * either side of the switch-over.
 */
export function healthcheckUrl(env: NodeJS.ProcessEnv, ok: boolean): string | null {
  const base = (env.HEALTHCHECK_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return ok ? base : `${base}/fail`;
}

async function ping(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) });
  } catch (err) {
    // Best effort, always. A monitoring endpoint being down must never turn a
    // successful sweep into a failed unit.
    console.warn(`healthcheck ping failed: ${err instanceof Error ? err.message : err}`);
  }
}

function runChild(cmd: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" });
    // A spawn failure (bad path, not executable) must not look like success.
    child.on("error", (err) => {
      console.error(`could not start the collector: ${err.message}`);
      res(EX_CONFIG);
    });
    child.on("close", (code, signal) => res(signal ? 128 : (code ?? 1)));
  });
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const report = validateEnv(env);
  for (const w of report.warnings) console.warn(`WARN ${w}`);
  console.log(describeEnv(report));
  if (!report.ok) {
    for (const e of report.errors) console.error(`FATAL ${e}`);
    return EX_CONFIG;
  }

  const dir = stateDir(env);
  // `acquireLock` uses a NON-recursive mkdir (that is what makes it atomic), so
  // the parent has to exist. deploy.sh creates it, but a tmpfs /var/lib or a
  // hand-cleaned box would otherwise crash the run instead of sweeping.
  mkdirSync(dir, { recursive: true });
  const lockDir = resolve(dir, "collect.lock");
  const maxHoldMs = Number(env.MODADROP_MAX_HOLD_MS ?? DEFAULT_MAX_HOLD_MS);
  const startedAt = new Date();

  const lock = acquireLock(lockDir, startedAt, maxHoldMs);
  if (!lock.ok) {
    // Exit 0 on purpose: a skipped tick is the guard working, not a failure, and
    // a non-zero exit would light up `systemctl --failed` on every busy tick.
    console.log(`skipped: ${lock.reason}`);
    return 0;
  }
  console.log(`${lock.reason}; scope ${describeScope(env)}`);

  try {
    const code = await runChild(collectCommand(env));
    const finishedAt = new Date();
    const durationSec = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
    if (code !== 0) {
      // No heartbeat on failure. A failed run that still bumped the heartbeat
      // would keep the watchdog quiet while nothing was being collected — the
      // exact outage this whole file is here to make visible.
      console.error(`collector exited ${code} after ${durationSec}s — heartbeat NOT updated`);
      await ping(healthcheckUrl(env, false));
      return code;
    }
    const hb: Heartbeat = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSec,
      scope: describeScope(env),
      revision: revision(env),
      host: hostname(),
    };
    writeHeartbeat(resolve(dir, "heartbeat.json"), hb);
    console.log(`collector finished in ${durationSec}s; heartbeat written`);
    await ping(healthcheckUrl(env, true));
    return 0;
  } finally {
    releaseLock(lockDir);
  }
}

// Only when run as the program, so the tests can import `main` freely.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
