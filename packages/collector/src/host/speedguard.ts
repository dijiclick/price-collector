/**
 * The app-speed guard. The background AI jobs (embed, look, tagger, packshots,
 * stylist-judge) share this box with the Postgres the app API reads, and on
 * 2026-10-23 they took it to load 19 on 8 cores: uncached API calls took
 * 7–30 s until their CPU was capped by hand. Owner: when the Mac is off, a
 * problem like that has to be found and handled without anybody.
 *
 * Every 10 minutes (modadrop-speedguard.timer) this:
 *   1. times three uncached API calls, 3 samples each (cache-busting params,
 *      `fresh=1` for deals), and reads load, memory/swap and long queries;
 *   2. when an endpoint is slow (2 of 3 samples > 3 s) or the 5-min load has
 *      been > 24 (3x the cores) two runs running, throttles one step:
 *        step 1 — halve the AI jobs' CPUQuota (runtime only, never < 20%),
 *                 stop packshots + stylist-judge;
 *        step 2 — the next bad run: also stop tagger + look, quarter embed;
 *      and cancels queries older than 60 s from those jobs' own connections
 *      (by application_name, localhost only — never the API's);
 *   3. after 30 healthy minutes, undoes one step (step 2 first), so the jobs
 *      come back in reverse order and a relapse is caught before the next;
 *   4. emails the owner on each escalation and on full recovery, at most once
 *      an hour per kind.
 *
 * The decision is a pure function (`decide`), tested in speedguard.test.ts.
 * Everything that touches the box lives in `main` and its helpers. State is a
 * JSON file, not a table: the guard has to work when Postgres is the thing
 * that is struggling. Runtime caps live in /run (gone on reboot) and are
 * undone by deleting their drop-in, so the configured caps in the unit files
 * always win again — never `systemctl revert`, which also deletes the
 * hand-made /etc drop-ins. The caps belong in the unit files, NOT in /etc
 * drop-ins: drop-ins apply in file-name order across directories, so an
 * /etc/…/cap.conf sorts after the runtime 50-CPUQuota.conf and silently wins
 * at the next daemon-reload (seen 2026-10-23).
 */
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { sendAlert } from "./watchdog";

const run = promisify(execFile);

export interface Job {
  unit: string;
  /** The configured cap, percent of one core. Used when the box cannot be asked. */
  cap: number;
  /** The step at which the job is stopped; below it, it is only slowed. 0 = never stopped. */
  stopAt: 0 | 1 | 2;
}

/** Same caps as the unit files in the repo (scripts/collector-host, scripts/embed). */
export const JOBS: Job[] = [
  { unit: "modadrop-embed.service", cap: 150, stopAt: 0 },
  { unit: "modadrop-look.service", cap: 120, stopAt: 2 },
  { unit: "modadrop-tagger.service", cap: 60, stopAt: 2 },
  { unit: "modadrop-packshots.service", cap: 60, stopAt: 1 },
  { unit: "modadrop-stylist-judge.service", cap: 50, stopAt: 1 },
];

/** The application_name each job connects with (PGAPPNAME in its unit). Only these are ever cancelled. */
export const JOB_APP_NAMES = ["modadrop-embed", "modadrop-look", "modadrop-tagger", "modadrop-packshots", "modadrop-stylist-judge"];

export interface Config {
  slowMs: number;
  /** An endpoint is slow when at least this many of its samples are. */
  slowOf: number;
  loadHigh: number;
  /** Consecutive runs with load5 > loadHigh before load alone counts as bad. */
  loadRuns: number;
  healthyMs: number;
  emailGapMs: number;
  minQuota: number;
}

export const DEFAULTS: Config = {
  slowMs: 3000,
  slowOf: 2,
  // 24 = 3x the cores (2026-10-23): at 12 the guard throttled the AI jobs while every endpoint
  // answered in 0.3 s. Latency is what users feel; load alone is only a last-resort net.
  loadHigh: 24,
  loadRuns: 2,
  healthyMs: 30 * 60000,
  emailGapMs: 60 * 60000,
  minQuota: 20,
};

export interface EndpointReading {
  name: string;
  /** One entry per sample: milliseconds, or null when it failed (timeout, network, non-200). */
  samples: (number | null)[];
}

export interface Reading {
  endpoints: EndpointReading[];
  load: [number, number, number];
  memAvailMb: number;
  memTotalMb: number;
  swapUsedMb: number;
  /** Active client queries running > 10 s, any role. */
  longQueries: number;
}

export interface GuardState {
  level: 0 | 1 | 2;
  /** Consecutive runs with load5 above the line. */
  loadRuns: number;
  /** Start of the current healthy streak while throttled ("" = not healthy / not throttled). */
  healthySince: string;
  /** When the current incident began ("" when level 0). */
  incidentSince: string;
  /** Units this guard stopped and so must start again. Never a unit somebody else stopped. */
  stopped: string[];
  /** Each job's configured cap as read from the box just before the first step (percent). */
  baseline: Record<string, number>;
  /** Last email per kind ("step1", "step2", "recovered"), ISO. */
  emailed: Record<string, string>;
  productId: number;
  productPickedAt: string;
}

export const INITIAL: GuardState = {
  level: 0, loadRuns: 0, healthySince: "", incidentSince: "", stopped: [], baseline: {}, emailed: {}, productId: 0, productPickedAt: "",
};

export function slowCount(samples: (number | null)[], slowMs: number): number {
  return samples.filter((s) => s === null || s > slowMs).length;
}

export function median(samples: (number | null)[]): number | null {
  const ok = samples.filter((s): s is number => s !== null).sort((a, b) => a - b);
  if (!ok.length) return null;
  return ok[Math.floor(ok.length / 2)];
}

export interface Assessment {
  bad: boolean;
  healthy: boolean;
  loadRuns: number;
  reasons: string[];
}

export function assess(r: Reading, prevLoadRuns: number, cfg: Config = DEFAULTS): Assessment {
  const reasons: string[] = [];
  let slow = false;
  for (const e of r.endpoints) {
    const n = slowCount(e.samples, cfg.slowMs);
    if (n >= cfg.slowOf) {
      slow = true;
      reasons.push(`${e.name} slow in ${n}/${e.samples.length} samples (${fmtSamples(e.samples)})`);
    }
  }
  const loadHigh = r.load[1] > cfg.loadHigh;
  const loadRuns = loadHigh ? prevLoadRuns + 1 : 0;
  const loadBad = loadRuns >= cfg.loadRuns;
  if (loadBad) reasons.push(`load5 ${r.load[1].toFixed(1)} > ${cfg.loadHigh} for ${loadRuns} runs`);
  // One high-load run is not bad enough to act on, but it is not healthy either.
  return { bad: slow || loadBad, healthy: !slow && !loadHigh, loadRuns, reasons };
}

export type Transition = "escalate" | "hold" | "step-down" | "recover" | "none";

export interface EmailPlan { kind: string; subject: string; body: string }

export interface Decision {
  next: GuardState;
  transition: Transition;
  /** The level whose actions should now be in force. */
  level: 0 | 1 | 2;
  /** Cancel the jobs' long queries this run. */
  cancel: boolean;
  email: EmailPlan | null;
  /** Why an email that was due was not sent. */
  emailSuppressed: string | null;
}

/**
 * The whole policy. `actions` is filled in by the caller once the step has run
 * (what was stopped, what was cancelled), and is only used for the email text.
 */
export function decide(state: GuardState, a: Assessment, now: Date, cfg: Config = DEFAULTS): Decision {
  const next: GuardState = { ...state, loadRuns: a.loadRuns, stopped: [...state.stopped], emailed: { ...state.emailed } };
  const iso = now.toISOString();
  let transition: Transition = "none";

  if (a.bad) {
    next.healthySince = "";
    if (state.level < 2) {
      next.level = (state.level + 1) as 1 | 2;
      if (state.level === 0) next.incidentSince = iso;
      transition = "escalate";
    } else transition = "hold";
  } else if (state.level > 0) {
    if (!a.healthy) next.healthySince = "";
    else if (!state.healthySince) next.healthySince = iso;
    else if (now.getTime() - Date.parse(state.healthySince) >= cfg.healthyMs) {
      next.level = (state.level - 1) as 0 | 1;
      // The next step back needs its own 30 healthy minutes.
      next.healthySince = next.level > 0 ? iso : "";
      transition = next.level === 0 ? "recover" : "step-down";
      if (next.level === 0) next.incidentSince = "";
    }
  }

  const kind = transition === "escalate" ? `step${next.level}` : transition === "recover" ? "recovered" : null;
  let email: EmailPlan | null = null;
  let emailSuppressed: string | null = null;
  if (kind) {
    const last = Date.parse(state.emailed[kind] ?? "");
    if (!Number.isNaN(last) && now.getTime() - last < cfg.emailGapMs) {
      emailSuppressed = `${kind} already emailed at ${state.emailed[kind]}`;
    } else {
      email = { kind, subject: "", body: "" };
      next.emailed[kind] = iso;
    }
  }
  return { next, transition, level: next.level, cancel: a.bad && next.level > 0, email, emailSuppressed };
}

export interface LevelPlan {
  /** unit → runtime CPUQuota percent, or null for "back to the configured cap". */
  quota: Record<string, number | null>;
  stop: string[];
  run: string[];
}

/** What each job should look like at a level. Halved per step, never below minQuota. */
export function planFor(level: 0 | 1 | 2, baseline: Record<string, number>, jobs: Job[] = JOBS, minQuota = DEFAULTS.minQuota): LevelPlan {
  const plan: LevelPlan = { quota: {}, stop: [], run: [] };
  for (const j of jobs) {
    if (j.stopAt > 0 && level >= j.stopAt) { plan.stop.push(j.unit); continue; }
    plan.run.push(j.unit);
    if (level === 0) { plan.quota[j.unit] = null; continue; }
    const base = baseline[j.unit] ?? j.cap;
    plan.quota[j.unit] = Math.max(minQuota, Math.floor(base / 2 ** level));
  }
  return plan;
}

function fmtSamples(s: (number | null)[]): string {
  return s.map((x) => (x === null ? "fail" : `${(x / 1000).toFixed(1)}s`)).join(", ");
}

export function readingText(r: Reading): string {
  const lines = r.endpoints.map((e) => {
    const m = median(e.samples);
    return `  ${e.name}: median ${m === null ? "fail" : `${(m / 1000).toFixed(1)} s`}  [${fmtSamples(e.samples)}]`;
  });
  return (
    `Uncached API (3 samples each, slow = > 3 s):\n${lines.join("\n")}\n` +
    `Load: ${r.load.map((x) => x.toFixed(1)).join(" / ")} (1/5/15 min, 8 cores)\n` +
    `Memory: ${r.memAvailMb} MB available of ${r.memTotalMb} MB, swap used ${r.swapUsedMb} MB\n` +
    `Postgres: ${r.longQueries} active queries > 10 s\n`
  );
}

/** Subject + body for an email `decide` asked for, once the actions are known. */
export function composeEmail(kind: string, host: string, a: Assessment, r: Reading, actions: string[], state: GuardState, now: Date): { subject: string; body: string } {
  const did = actions.length ? actions.map((x) => `  - ${x}`).join("\n") : "  - nothing (already in place)";
  if (kind === "recovered") {
    const mins = state.incidentSince ? Math.round((now.getTime() - Date.parse(state.incidentSince)) / 60000) : null;
    return {
      subject: `[modadrop] app speed OK again — AI jobs restored (${host})`,
      body:
        `The app API has been fast for 30 min, so the speed guard put the background AI jobs back.\n\n` +
        `${readingText(r)}\nRestored:\n${did}\n\n` +
        (mins !== null ? `The incident lasted ${mins} min.\n` : "") +
        `Log: /var/log/modadrop/speedguard.log on ${host}\n`,
    };
  }
  const step = kind === "step2" ? 2 : 1;
  return {
    subject: `[modadrop] app slow — speed guard step ${step}: ${step === 1 ? "AI jobs throttled" : "AI jobs stopped"} (${host})`,
    body:
      `Why: ${a.reasons.join("; ")}\n\n${readingText(r)}\nWhat the guard did:\n${did}\n\n` +
      (step === 1
        ? `If it is still slow in 10 min it stops tagger + look too (step 2).\n`
        : `If it stays slow, the cause is not these jobs — look at Postgres and the collector:\n` +
          `  ssh root@${host === "main" ? "91.107.149.204" : host} "top -b -n1 | head -25"\n`) +
      `It undoes one step per 30 healthy minutes and emails when everything is back.\n` +
      `Log: /var/log/modadrop/speedguard.log\n`,
  };
}

// ---------------------------------------------------------------- the box --

export function readState(path: string): GuardState {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<GuardState>;
    return { ...INITIAL, ...raw, stopped: raw.stopped ?? [], baseline: raw.baseline ?? {}, emailed: raw.emailed ?? {} };
  } catch {
    return { ...INITIAL };
  }
}

export function writeState(path: string, state: GuardState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`, "utf8");
  renameSync(tmp, path);
}

/** "1.500000s" | "600ms" | "infinity" → percent of one core, or null. */
export function parseQuota(v: string): number | null {
  const m = v.trim().match(/^([\d.]+)(s|ms|us)$/);
  if (!m) return null;
  const sec = Number(m[1]) / (m[2] === "s" ? 1 : m[2] === "ms" ? 1000 : 1e6);
  return Math.round(sec * 100);
}

async function systemctl(...args: string[]): Promise<string> {
  const { stdout } = await run("systemctl", args, { timeout: 60000 });
  return stdout.trim();
}

async function psql(sql: string, timeoutMs = 10000): Promise<string> {
  const { stdout } = await run("runuser", ["-u", "postgres", "--", "psql", "modadrop", "-X", "-A", "-t", "-q", "-c", sql], {
    timeout: timeoutMs + 5000,
    env: { ...process.env, PGOPTIONS: `-c statement_timeout=${timeoutMs}` },
  });
  return stdout.trim();
}

async function timeGet(url: string, timeoutMs: number): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "modadrop-speedguard" } });
    await res.arrayBuffer();
    if (res.status !== 200) return null;
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  }
}

async function measure(env: NodeJS.ProcessEnv, productId: number): Promise<Reading> {
  const base = env.SPEEDGUARD_API ?? "https://modadrop.vercel.app";
  const endpoints: [string, string][] = [
    ["deals", "/api/deals?country=TR&limit=20&fresh=1"],
    ["stylist product", `/api/stylist?country=TR&product=${productId}`],
    ["stylist feed", "/api/stylist?country=TR&gender=kadin&occasion=everyday&page=0"],
  ];
  const fake = env.SPEEDGUARD_FAKE; // "slow" | "healthy" — test flag for a hand run
  const out: EndpointReading[] = [];
  for (const [name, path] of endpoints) {
    const samples: (number | null)[] = [];
    for (let i = 0; i < 3; i++) {
      if (fake === "slow") samples.push(9000 + i);
      else if (fake === "healthy") samples.push(400 + i);
      else samples.push(await timeGet(`${base}${path}&_sg=${Date.now()}-${i}`, 15000));
    }
    out.push({ name, samples });
  }
  const load = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).map(Number) as [number, number, number];
  const mem = Object.fromEntries(
    readFileSync("/proc/meminfo", "utf8").split("\n").filter(Boolean).map((l) => {
      const [k, v] = l.split(":");
      return [k, Math.round(parseInt(v, 10) / 1024)];
    }),
  ) as Record<string, number>;
  let longQueries = -1;
  try {
    longQueries = Number(await psql(
      "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND backend_type = 'client backend' " +
      "AND pid <> pg_backend_pid() AND now() - query_start > interval '10 seconds'",
    ));
  } catch { /* reported as -1 */ }
  return {
    endpoints: out,
    load: fake === "healthy" ? [1, 1, 1] : load,
    memAvailMb: mem.MemAvailable ?? 0,
    memTotalMb: mem.MemTotal ?? 0,
    swapUsedMb: (mem.SwapTotal ?? 0) - (mem.SwapFree ?? 0),
    longQueries,
  };
}

/** A TR product with stored look items, re-picked daily; the last good one if the pick fails. */
async function pickProduct(state: GuardState, now: Date): Promise<number> {
  const fresh = state.productId > 0 && now.getTime() - Date.parse(state.productPickedAt || "0") < 24 * 3600000;
  if (fresh) return state.productId;
  try {
    const id = Number(await psql(
      "SELECT li.product_id FROM look_items li JOIN products p ON p.id = li.product_id " +
      "WHERE p.country = 'TR' AND p.in_stock AND jsonb_array_length(li.items) >= 2 ORDER BY li.checked_at DESC LIMIT 1",
      15000,
    ));
    if (id > 0) {
      state.productId = id;
      state.productPickedAt = now.toISOString();
      return id;
    }
  } catch { /* keep the old one */ }
  return state.productId || 80461780;
}

async function readBaseline(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const j of JOBS) {
    try {
      const q = parseQuota(await systemctl("show", "-P", "CPUQuotaPerSecUSec", j.unit));
      if (q) out[j.unit] = q;
    } catch { /* falls back to the repo cap */ }
  }
  return out;
}

const RUNTIME_DIR = "/run/systemd/system.control";

/** Bring every job to `level`. Idempotent: a reboot or a hand restart just gets re-applied. */
async function applyLevel(level: 0 | 1 | 2, state: GuardState, dry: boolean): Promise<string[]> {
  const plan = planFor(level, state.baseline);
  const did: string[] = [];
  let reload = false;
  for (const unit of plan.stop) {
    const active = (await systemctl("is-active", unit).catch((e) => String(e.stdout ?? "").trim())) === "active";
    if (!active) continue;
    if (!dry) await systemctl("stop", unit);
    if (!state.stopped.includes(unit)) state.stopped.push(unit);
    did.push(`stopped ${unit.replace(".service", "")}`);
  }
  for (const unit of plan.run) {
    const q = plan.quota[unit];
    if (q !== null) {
      const cur = parseQuota(await systemctl("show", "-P", "CPUQuotaPerSecUSec", unit).catch(() => ""));
      if (cur !== q) {
        if (!dry) await systemctl("set-property", "--runtime", unit, `CPUQuota=${q}%`);
        did.push(`${unit.replace(".service", "")} CPU ${cur ?? "?"}% → ${q}%`);
      }
    } else {
      const f = `${RUNTIME_DIR}/${unit}.d/50-CPUQuota.conf`;
      if (existsSync(f)) {
        if (!dry) unlinkSync(f);
        reload = true;
        did.push(`${unit.replace(".service", "")} CPU back to its configured cap`);
      }
    }
    if (state.stopped.includes(unit)) {
      if (!dry) await systemctl("start", unit);
      state.stopped = state.stopped.filter((u) => u !== unit);
      did.push(`started ${unit.replace(".service", "")}`);
    }
  }
  if (reload && !dry) await systemctl("daemon-reload");
  return did;
}

async function cancelLongQueries(dry: boolean): Promise<string[]> {
  const names = JOB_APP_NAMES.map((n) => `'${n}'`).join(",");
  const fn = dry ? "true" : "pg_cancel_backend(pid)";
  try {
    const out = await psql(
      `SELECT application_name || ' ' || extract(epoch FROM now() - query_start)::int || 's ' || ${fn} ` +
      `FROM pg_stat_activity WHERE state = 'active' AND application_name IN (${names}) ` +
      `AND (client_addr IS NULL OR client_addr IN ('127.0.0.1', '::1')) AND now() - query_start > interval '60 seconds'`,
    );
    return out ? out.split("\n").map((l) => `cancelled query: ${l.replace(/ t$/, "")}`) : [];
  } catch (e) {
    return [`could not check long queries: ${e instanceof Error ? e.message.split("\n")[0] : e}`];
  }
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const dir = env.MODADROP_STATE_DIR ?? "/var/lib/modadrop";
  const statePath = resolve(dir, "speedguard.json");
  const logPath = env.SPEEDGUARD_LOG ?? "/var/log/modadrop/speedguard.jsonl";
  const dry = env.SPEEDGUARD_DRY_RUN === "1";
  const cfg: Config = { ...DEFAULTS, healthyMs: Number(env.SPEEDGUARD_HEALTHY_MIN ?? 30) * 60000 };
  const now = new Date();
  const host = hostname();

  const state = readState(statePath);
  const productId = await pickProduct(state, now);
  const reading = await measure(env, productId);
  const a = assess(reading, state.loadRuns, cfg);
  const d = decide(state, a, now, cfg);
  const next = d.next;
  next.productId = state.productId;
  next.productPickedAt = state.productPickedAt;

  if (d.transition === "escalate" && state.level === 0) next.baseline = await readBaseline();

  let actions: string[] = [];
  // Every run while throttled, not only on a change: a reboot, a hand restart
  // or anybody's daemon-reload can undo a runtime cap, and applyLevel only acts
  // on what differs. Level 0 runs it only on the way back down.
  if (d.level > 0 || d.transition !== "none") actions = await applyLevel(d.level, next, dry);
  if (d.cancel) actions.push(...(await cancelLongQueries(dry)));
  if (d.transition === "recover") next.baseline = {};

  let mailed = "";
  if (d.email) {
    const { subject, body } = composeEmail(d.email.kind, host, a, reading, actions, state, now);
    const tag = env.SPEEDGUARD_FAKE ? "[TEST] " : "";
    const ok = dry ? false : await sendAlert(env, `${tag}${subject}`, body);
    mailed = ok ? `emailed: ${subject}` : `EMAIL ${dry ? "skipped (dry run)" : "FAILED"}: ${subject}`;
    if (env.SPEEDGUARD_PRINT_EMAIL === "1") console.log(`--- email ---\n${tag}${subject}\n\n${body}--- end ---`);
  }
  // A test run must not use up the real hourly email budget.
  if (env.SPEEDGUARD_FAKE && d.email) next.emailed[d.email.kind] = state.emailed[d.email.kind] ?? "";

  writeState(statePath, next);
  const line = {
    at: now.toISOString(), level: next.level, transition: d.transition, healthy: a.healthy, reasons: a.reasons,
    medians: Object.fromEntries(reading.endpoints.map((e) => [e.name, median(e.samples)])),
    load: reading.load, memAvailMb: reading.memAvailMb, swapUsedMb: reading.swapUsedMb, longQueries: reading.longQueries,
    actions, mail: mailed || d.emailSuppressed || undefined, fake: env.SPEEDGUARD_FAKE || undefined, dry: dry || undefined,
  };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(line)}\n`);
  } catch { /* the journal still has it */ }
  console.log(
    `speedguard: level ${state.level}→${next.level} (${d.transition}) ` +
    `deals/product/feed ${reading.endpoints.map((e) => median(e.samples) ?? "fail").join("/")} ms, ` +
    `load ${reading.load.join(" ")}, avail ${reading.memAvailMb} MB, swap ${reading.swapUsedMb} MB, long q ${reading.longQueries}` +
    (actions.length ? ` | ${actions.join("; ")}` : "") + (mailed ? ` | ${mailed}` : d.emailSuppressed ? ` | ${d.emailSuppressed}` : ""),
  );
  return mailed.startsWith("EMAIL FAILED") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (err) => { console.error("speedguard crashed:", err); process.exit(2); });
}
