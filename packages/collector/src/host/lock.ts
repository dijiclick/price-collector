/**
 * The concurrency guard: never two collectors at once.
 *
 * This is not a nicety. Two overlapping sweeps both read `events` with
 * `push_notified_at IS NULL`, both send, and both mark — so a slow run
 * overlapping the next tick is how every tracked user gets the same price-drop
 * push twice. CLAUDE.md already warns about duplicate pushes for the "two
 * collectors running" case; a 30-minute timer in front of a job whose tail is
 * ~10 minutes makes that a scheduling question rather than a deployment one.
 *
 * WHY NOT `flock`: it is the right tool on Linux and the wrong tool here,
 * because macOS has no `flock(1)` and this logic then cannot be tested on the
 * machine it is written on — which is how an untested guard ships. `mkdir` is
 * atomic on every POSIX filesystem and gives the same mutual exclusion, at the
 * cost of having to reason about a lock left behind by a killed process. That
 * reasoning is exactly what is unit-tested below.
 *
 * WHY NOT rely on systemd alone: a timer whose service is already running does
 * not skip the trigger, it QUEUES it, so the second run starts the moment the
 * first ends and the sweep rate doubles under load instead of holding steady.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LockVerdict =
  /** Nobody holds it: run. */
  | { action: "acquire"; reason: string }
  /** Another live run holds it: exit 0 quietly, the next tick will try again. */
  | { action: "skip"; reason: string }
  /** Holder is gone or impossibly old: take it, and say so loudly. */
  | { action: "steal"; reason: string };

export interface LockState {
  /** pid recorded in the lock, or null when the lock dir has no readable pid. */
  pid: number | null;
  /** Is that pid still a live process? */
  alive: boolean;
  /** How long the lock has existed, milliseconds. */
  ageMs: number;
}

/**
 * Decide what to do about an existing lock.
 *
 * `maxHoldMs` is the point past which a "live" holder is assumed wedged — a
 * collector hung on a socket with no timeout would otherwise hold the lock
 * forever and stop every future sweep, turning a stuck run into a total
 * outage. The whole sweep is ~7 min, so a multiple of that is generous.
 */
export function lockVerdict(state: LockState | null, maxHoldMs: number): LockVerdict {
  if (!state) return { action: "acquire", reason: "no lock held" };
  if (state.pid === null) {
    return { action: "steal", reason: "lock directory exists but holds no readable pid — assuming a crash" };
  }
  if (!state.alive) {
    return { action: "steal", reason: `lock held by pid ${state.pid}, which is not running — assuming a crash` };
  }
  if (state.ageMs > maxHoldMs) {
    return {
      action: "steal",
      reason:
        `lock held by live pid ${state.pid} for ${Math.round(state.ageMs / 60000)} min ` +
        `(limit ${Math.round(maxHoldMs / 60000)} min) — assuming it is wedged`,
    };
  }
  return {
    action: "skip",
    reason: `a collector run (pid ${state.pid}) has been going ${Math.round(state.ageMs / 1000)}s — skipping this tick`,
  };
}

/** Default: a run may hold the lock for 45 minutes. Sweeps take ~7. */
export const DEFAULT_MAX_HOLD_MS = 45 * 60 * 1000;

const pidAlive = (pid: number): boolean => {
  try {
    // Signal 0 tests for existence and permission without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function readLockState(dir: string, now: Date, aliveFn: (pid: number) => boolean = pidAlive): LockState | null {
  let text: string;
  try {
    text = readFileSync(join(dir, "pid"), "utf8");
  } catch (err) {
    // ENOENT on the pid file inside an existing dir is a crash mid-acquire, and
    // ENOENT on the dir itself means no lock. Both are distinguished by trying
    // the directory: rmSync/readdir would be a second syscall for no gain, so
    // treat a missing pid file as "lock present, pid unknown" only when the
    // directory is there.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    try {
      readFileSync(dir); // EISDIR when the lock dir exists, ENOENT when it does not.
    } catch (dirErr) {
      const code = (dirErr as NodeJS.ErrnoException).code;
      if (code === "EISDIR") return { pid: null, alive: false, ageMs: 0 };
      return null;
    }
    return null;
  }
  const [pidStr, startedAt] = text.trim().split(/\s+/, 2);
  const pid = Number(pidStr);
  const started = Date.parse(startedAt ?? "");
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    alive: Number.isInteger(pid) && pid > 0 ? aliveFn(pid) : false,
    ageMs: Number.isNaN(started) ? 0 : Math.max(0, now.getTime() - started),
  };
}

/**
 * Take the lock, or report why not. `mkdirSync` without `recursive` throws
 * EEXIST atomically, which is the whole mechanism.
 */
export function acquireLock(
  dir: string,
  now: Date,
  maxHoldMs: number = DEFAULT_MAX_HOLD_MS,
): { ok: true; reason: string } | { ok: false; reason: string } {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dir); // parent must already exist; the deploy creates it.
      writeFileSync(join(dir, "pid"), `${process.pid} ${now.toISOString()}\n`, "utf8");
      return { ok: true, reason: "lock acquired" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const verdict = lockVerdict(readLockState(dir, now), maxHoldMs);
    if (verdict.action === "skip") return { ok: false, reason: verdict.reason };
    // acquire/steal: clear it and go round once more. A single retry, so two
    // processes racing to steal cannot ping-pong forever.
    rmSync(dir, { recursive: true, force: true });
  }
  return { ok: false, reason: "could not take the lock after stealing it — another process is racing" };
}

export function releaseLock(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
