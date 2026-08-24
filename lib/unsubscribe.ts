import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe links.
 *
 * Stateless on purpose: the token is an HMAC of the address, so there is no
 * schema to add and no row to keep in step with the watchlist. Knowing a token
 * proves nothing about the key, and a token for one address cannot be turned
 * into a token for another — which matters because the link travels through
 * mail servers and scanners.
 *
 * The key is `UNSUBSCRIBE_SECRET` and nothing else.
 *
 * This first fell back to `DATABASE_URL`, reasoning that it was the one secret
 * both the collector that writes links and the web app that verifies them
 * already hold. It is not: a token signed with the local connection string was
 * refused by production, because Vercel and GitHub Actions hold DIFFERENT
 * strings for the same database — pooled and direct URLs, or the same URL with
 * different parameters. The fallback produced exactly the failure it was meant
 * to prevent, and silently: every link would have looked right and none would
 * have worked.
 *
 * So there is no fallback. Without the secret nothing can be signed, and the
 * notifier refuses to send rather than mailing an unsubscribe link that is
 * guaranteed to fail.
 */
function key(env: NodeJS.ProcessEnv = process.env): string {
  return env.UNSUBSCRIBE_SECRET || "";
}

/** Whether links can be produced at all. The notifier checks this before sending. */
export function canSign(env: NodeJS.ProcessEnv = process.env): boolean {
  return key(env).length > 0;
}

/** Lowercased and trimmed, so a link works whatever case the address arrived in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function signEmail(email: string, env?: NodeJS.ProcessEnv): string {
  const k = key(env);
  if (!k) throw new Error("UNSUBSCRIBE_SECRET is not set — refusing to mint an unverifiable link");
  return createHmac("sha256", k).update(normalizeEmail(email)).digest("hex").slice(0, 32);
}

export function verifyEmail(email: string, token: string, env?: NodeJS.ProcessEnv): boolean {
  if (!canSign(env)) return false; // unsigned deployment — refuse rather than accept anything
  if (typeof token !== "string" || token.length !== 32) return false;
  const expected = Buffer.from(signEmail(email, env));
  const got = Buffer.from(token);
  // Lengths already match, so timingSafeEqual is safe to call.
  return timingSafeEqual(expected, got);
}

function params(email: string, env?: NodeJS.ProcessEnv): string {
  return new URLSearchParams({ e: normalizeEmail(email), t: signEmail(email, env) }).toString();
}

/** The footer link a person clicks: a page with a button, so scanners cannot fire it. */
export function unsubscribeUrl(email: string, base: string, env?: NodeJS.ProcessEnv): string {
  return `${base}/abonelik?${params(email, env)}`;
}

/**
 * The List-Unsubscribe target, which must accept a POST — RFC 8058 one-click
 * posts to it directly. That has to be the API route: posting to the page would
 * come back 405 and the mail client would report the unsubscribe as failed.
 */
export function unsubscribePostUrl(email: string, base: string, env?: NodeJS.ProcessEnv): string {
  return `${base}/api/unsubscribe?${params(email, env)}`;
}
