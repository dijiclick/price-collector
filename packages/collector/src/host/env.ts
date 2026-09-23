/**
 * Environment validation for the SELF-HOSTED collector runner.
 *
 * On GitHub Actions a missing secret is visible in the workflow file and the
 * run log. On a box it is invisible: `pnpm collect` with no `RESEND_API_KEY`
 * collects happily, marks events notified, and silently sends nobody an email.
 * That is the failure this module exists to make loud.
 *
 * NOTHING HERE EVER READS A SECRET'S VALUE INTO A MESSAGE. Every report is
 * names and presence only, because these messages go to stdout, to the journal,
 * and into alert emails.
 */

/** Without this the run cannot do anything at all. */
const REQUIRED = ["DATABASE_URL"] as const;

/**
 * Present on the GitHub runner, so a box without them is a REGRESSION even
 * though the collection itself still works. Each one silently disables a
 * delivery channel — which is the entire product.
 *
 * Each entry is a list of ALTERNATIVES, because `push-transport.ts` takes each
 * credential either inline or as a path — on a real box the path form is better
 * (no escaping a PEM into an EnvironmentFile) and must not read as missing.
 */
const EXPECTED: readonly (readonly string[])[] = [
  ["APNS_KEY", "APNS_KEY_PATH"], // iOS push. Absent = no iPhone notifications.
  ["APNS_KEY_ID"], // The push transport refuses to guess this.
  ["FCM_SERVICE_ACCOUNT", "FCM_SERVICE_ACCOUNT_PATH"], // Android push.
  ["RESEND_API_KEY"], // Email digests.
  ["RESEND_FROM"], // Falls back to resend.dev, which lands in spam.
  /*
   * Not decorative. `notifier.ts` refuses to send ANY digest without it —
   * "refusing to send without a working unsubscribe link" — and it is not in
   * the GitHub workflow's env block either, so email has been silently off in
   * production (verified in run 35511066777, 2026-09-20). A host that gets
   * every other secret right and misses this one sends no email at all.
   */
  ["UNSUBSCRIBE_SECRET"],
];

/**
 * Genuinely optional: a brand sits out or degrades, nothing else breaks.
 * `DATAIMPULSE_PROXY` is listed because GitHub never had it either (see the
 * "collector runs from a PUBLIC repo" note in CLAUDE.md).
 */
const OPTIONAL = ["DATAIMPULSE_PROXY", "SEPHORA_CLIENT_ID", "SKIP_BRANDS", "ONLY_BRANDS", "COUNTRIES"] as const;

export interface EnvReport {
  /** False only when something in REQUIRED is missing or malformed. */
  ok: boolean;
  /** Fatal problems. The runner refuses to start. */
  errors: string[];
  /** Non-fatal, but each one means a delivery channel is off. */
  warnings: string[];
  /** Names of every variable that is set, for the log. Never values. */
  present: string[];
}

const isSet = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

/**
 * A scratch run must not be able to reach production by accident, and a
 * production run must not silently fall through to the PGlite dev fallback.
 * So `DATABASE_URL` is checked for shape, not just presence.
 */
function checkDatabaseUrl(raw: string, errors: string[], warnings: string[]): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    errors.push("DATABASE_URL is not a URL");
    return;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    errors.push(`DATABASE_URL protocol is "${url.protocol}", expected postgres:`);
    return;
  }
  if (!url.hostname) errors.push("DATABASE_URL has no host");
  if (!url.pathname.replace(/^\//, "")) errors.push("DATABASE_URL names no database");
  // The Hetzner box's certificate is self-signed, so `require` is the strongest
  // mode that works — but omitting sslmode entirely means postgres.js connects
  // in the clear over the public internet.
  if (!url.searchParams.has("sslmode")) {
    warnings.push("DATABASE_URL has no sslmode — append ?sslmode=require so the connection is encrypted");
  }
}

export function validateEnv(env: NodeJS.ProcessEnv): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const present: string[] = [];

  for (const name of [...REQUIRED, ...EXPECTED.flat(), ...OPTIONAL]) {
    if (isSet(env[name])) present.push(name);
  }

  for (const name of REQUIRED) {
    if (!isSet(env[name])) errors.push(`${name} is not set`);
  }
  if (isSet(env.DATABASE_URL)) checkDatabaseUrl(env.DATABASE_URL, errors, warnings);

  for (const alternatives of EXPECTED) {
    if (!alternatives.some((name) => isSet(env[name]))) {
      warnings.push(`${alternatives.join(" / ")} is not set — the channel it drives is silently disabled`);
    }
  }

  // A box that still has PGLITE_DIR set from a scratch run would write real
  // collections into an embedded file nobody reads.
  if (isSet(env.PGLITE_DIR) && isSet(env.DATABASE_URL)) {
    warnings.push("PGLITE_DIR is set alongside DATABASE_URL — leftover scratch config?");
  }

  return { ok: errors.length === 0, errors, warnings, present };
}

/** One line for the journal. Names only — safe to log and to email. */
export function describeEnv(report: EnvReport): string {
  return `env: ${report.present.length} set (${report.present.join(", ") || "none"})`;
}
