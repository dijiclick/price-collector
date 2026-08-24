import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sending push ourselves, without Expo's relay.
 *
 * Tokens tell us which transport to use, and that is what makes the migration
 * safe: devices running the current build hold `ExponentPushToken[…]` and must
 * keep working until they update, while new builds register a native token.
 * Routing per token means no flag day and nobody silently stops receiving
 * price drops.
 *
 * - APNs: hex device token, 64 chars.
 * - FCM: long opaque string, usually containing ':' and much longer.
 * - Expo: literally `ExponentPushToken[…]` — the legacy path, kept until the
 *   installed base has rotated.
 */
export type Transport = "apns" | "fcm" | "expo";

export function classifyToken(token: string): Transport | null {
  const t = (token ?? "").trim();
  if (!t) return null;
  if (/^ExponentPushToken\[.+\]$/.test(t) || /^ExpoPushToken\[.+\]$/.test(t)) return "expo";
  // ANY plain-hex token is APNs, not just a 32-byte one. Apple has never
  // promised 32 bytes and iOS 17 hands out 80 — this simulator's is 160 hex
  // chars. The old rule matched exactly 64 and then let everything else fall
  // into the length>=100 branch below, so a modern iPhone was routed to
  // Firebase and would never have received a single notification.
  if (/^[0-9a-f]+$/i.test(t) && t.length >= 64) return "apns";
  // FCM registration ids are long and NOT plain hex — they carry ':' and
  // base64url characters.
  if (t.length >= 100) return "fcm";
  return null;
}

/**
 * APNs provider JWT (ES256 over the .p8). Apple accepts a token for one hour;
 * callers should cache it rather than signing per notification — Apple rate
 * limits providers that mint a fresh token for every push.
 */
export function signApnsJwt(opts: {
  key: string | Buffer;
  keyId: string;
  teamId: string;
  now?: number;
}): string {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "ES256", kid: opts.keyId });
  const claims = b64({ iss: opts.teamId, iat });
  const signature = createSign("SHA256")
    .update(`${header}.${claims}`)
    // APNs wants raw R||S, not the DER wrapper Node emits by default.
    .sign({ key: opts.key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export interface PushContent {
  title: string;
  body: string;
  productId: number;
  kind: "drop" | "target" | "restock";
  pct?: number;
}

/** APNs payload. `content-available` stays off: these are user-facing alerts. */
export function buildApnsPayload(c: PushContent): Record<string, unknown> {
  return {
    aps: {
      alert: { title: c.title, body: c.body },
      sound: "default",
      "thread-id": String(c.productId),
    },
    productId: c.productId,
    kind: c.kind,
    ...(c.pct != null ? { pct: c.pct } : {}),
  };
}

/**
 * FCM HTTP v1 message. Data values must be strings — v1 rejects numbers — and
 * the client parses them back, which is why `pct` is stringified here.
 */
export function buildFcmMessage(token: string, c: PushContent): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: c.title, body: c.body },
      data: {
        productId: String(c.productId),
        kind: c.kind,
        ...(c.pct != null ? { pct: String(c.pct) } : {}),
      },
      android: { priority: "high", notification: { channel_id: "price-drops" } },
    },
  };
}

/** Tokens APNs/FCM report as permanently invalid — prune these, do not retry. */
export function isDeadTokenResponse(status: number, body: string): boolean {
  if (status === 410) return true; // APNs Unregistered
  return /BadDeviceToken|Unregistered|UNREGISTERED|INVALID_ARGUMENT|NotRegistered/.test(body);
}

/* ------------------------------------------------------------- credentials */

export interface PushCreds {
  apns?: { key: string | Buffer; keyId: string; teamId: string; bundleId: string; production: boolean };
  fcm?: { clientEmail: string; privateKey: string; projectId: string };
}

/**
 * Load signing material from this machine. Nothing is fetched from a hosted
 * service — the whole point of moving off Expo's relay. Missing credentials
 * disable that transport rather than throwing, so a run with only one
 * configured still delivers to the other platform.
 */
export function loadCreds(env: NodeJS.ProcessEnv = process.env): PushCreds {
  // Imported at the top, NOT require()'d here. This package is `"type":
  // "module"`, so `require` is undefined at runtime — but vitest's transform
  // provides one, which is exactly why 341 green tests sat on top of a push
  // pipeline that had thrown `require is not defined` on every CI run since
  // 2026-08-14 and delivered nothing.
  const out: PushCreds = {};
  const home = env.HOME ?? "";

  // Contents-or-path, and a sensible default. On this Mac the keys are already
  // where the defaults point, so a local `pnpm collect` needs no setup at all.
  // CI has no filesystem to put them on, so it passes the contents instead —
  // one secret each, no files to provision.
  const read = (contents?: string, path?: string, fallback?: string): string | null => {
    if (contents && contents.trim()) return contents;
    // An explicitly configured path wins outright — and if it is wrong, that is
    // an error worth surfacing as "no credentials", not something to paper over
    // by quietly loading a different key than the operator asked for.
    if (path) return existsSync(path) ? readFileSync(path, "utf8") : null;
    return fallback && existsSync(fallback) ? readFileSync(fallback, "utf8") : null;
  };

  // NOT ~/.appstoreconnect/private_keys — those are App Store Connect API keys,
  // used to upload builds. APNs is a separate key type from the same portal
  // page, and Apple rejects an ASC key with 403 InvalidProviderToken (verified
  // 2026-08-15 against AuthKey_3377BB8CCS). Defaulting here would look
  // configured while never delivering a single notification.
  const apnsKey = read(env.APNS_KEY, env.APNS_KEY_PATH, "apps/mobile/credentials/apns.p8");
  const keyId = env.APNS_KEY_ID ?? "B4853CR4R6"; // "Modadrop Push", APNs-enabled
  const teamId = env.APNS_TEAM_ID ?? "4M5B7GDD73";
  if (apnsKey && keyId && teamId) {
    out.apns = {
      key: apnsKey,
      keyId,
      teamId,
      bundleId: env.APNS_BUNDLE_ID ?? "com.modadrop.app",
      // Default to production: the shipped app's entitlement is production, and
      // sending to sandbox silently fails for real users.
      production: env.APNS_SANDBOX !== "1",
    };
  }

  const saRaw = read(
    env.FCM_SERVICE_ACCOUNT,
    env.FCM_SERVICE_ACCOUNT_PATH,
    "apps/mobile/credentials/firebase-service-account.json",
  );
  if (saRaw) {
    try {
      const sa = JSON.parse(saRaw);
      if (sa.client_email && sa.private_key && sa.project_id) {
        out.fcm = { clientEmail: sa.client_email, privateKey: sa.private_key, projectId: sa.project_id };
      }
    } catch {
      /* malformed secret — that transport stays off rather than crashing the run */
    }
  }
  return out;
}

/* ------------------------------------------------------------------- FCM */

let fcmToken: { value: string; expires: number } | null = null;

/**
 * OAuth2 access token for FCM, cached until shortly before expiry. Minting one
 * per notification would be both slow and rate-limited.
 */
export async function fcmAccessToken(
  fcm: NonNullable<PushCreds["fcm"]>,
  now = Date.now(),
): Promise<string | null> {
  if (fcmToken && fcmToken.expires > now + 60_000) return fcmToken.value;
  const iat = Math.floor(now / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({
    iss: fcm.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  });
  const sig = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(fcm.privateKey)
    .toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${sig}`,
    }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  fcmToken = { value: j.access_token, expires: now + (j.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}

export interface SendResult { ok: boolean; dead: boolean }

export async function sendFcm(
  fcm: NonNullable<PushCreds["fcm"]>,
  token: string,
  content: PushContent,
): Promise<SendResult> {
  const access = await fcmAccessToken(fcm);
  if (!access) return { ok: false, dead: false }; // auth blip — retry next run
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildFcmMessage(token, content)),
    },
  ).catch(() => null);
  if (!res) return { ok: false, dead: false };
  if (res.ok) return { ok: true, dead: false };
  const body = await res.text().catch(() => "");
  return { ok: false, dead: isDeadTokenResponse(res.status, body) };
}

/* ------------------------------------------------------------------ APNs */

let apnsJwt: { value: string; minted: number } | null = null;

/** Apple rejects providers that mint a token per push; reuse for ~50 minutes. */
function apnsAuth(apns: NonNullable<PushCreds["apns"]>, now = Date.now()): string {
  if (apnsJwt && now - apnsJwt.minted < 50 * 60_000) return apnsJwt.value;
  const value = signApnsJwt({ key: apns.key, keyId: apns.keyId, teamId: apns.teamId, now });
  apnsJwt = { value, minted: now };
  return value;
}

/**
 * APNs speaks HTTP/2 only — `fetch` cannot reach it, so this uses node:http2
 * directly. One session is opened per call here for simplicity; batching is a
 * later optimisation, and volumes are small (one push per watcher per drop).
 */
export async function sendApns(
  apns: NonNullable<PushCreds["apns"]>,
  token: string,
  content: PushContent,
): Promise<SendResult> {
  const http2 = await import("node:http2");
  const host = apns.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const done = (r: SendResult) => { if (!settled) { settled = true; resolve(r); } };
    const client = http2.connect(host);
    client.on("error", () => done({ ok: false, dead: false }));
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${apnsAuth(apns)}`,
      "apns-topic": apns.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    req.on("data", (d) => { body += d; });
    req.on("error", () => { done({ ok: false, dead: false }); client.close(); });
    req.on("end", () => {
      done({ ok: status === 200, dead: isDeadTokenResponse(status, body) });
      client.close();
    });
    req.end(JSON.stringify(buildApnsPayload(content)));
  });
}
