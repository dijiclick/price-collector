/**
 * ASICS United States by url (`asics.com/us/en-us/<slug>/p/ANA_1042A301-101.html`).
 *
 * The site itself is behind Akamai; Salesforce's Commerce API host is not
 * (see packages/collector/src/brands/asics.ts). A guest token comes from the
 * public SLAS client (PKCE, two calls), then Shopper Products answers the
 * colour group the url names, with the same `c_custom.price.model` ladder
 * the sale grid strikes through. The id is the colour group id
 * (`ANA_<style>-<colour>`), as the collector's.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, json, toMinor } from "../live-http";

const ORIGIN = "https://www.asics.com";
const HOST = "https://y841ero5.api.commercecloud.salesforce.com";
const ORG = "f_ecom_bbtn_prd";
const CLIENT = "32c40d28-93fc-4889-a473-14543e1cbcb5";
const SITE_ID = "asics-us";

export function asicsIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)asics\.com$/i.test(u.hostname) || !/^\/us\/en-us\//i.test(u.pathname)) return null;
  return u.pathname.match(/\/p\/(ANA_[A-Z0-9]+-[A-Z0-9]+)\.html$/i)?.[1]?.toUpperCase() ?? null;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf as Uint8Array).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function guestToken(country: string): Promise<string | null> {
  try {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const redirect = `${ORIGIN}/callback`;
    const q = new URLSearchParams({ redirect_uri: redirect, response_type: "code", client_id: CLIENT, hint: "guest", code_challenge: challenge, channel_id: SITE_ID });
    const a = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    const loc = new URL(a.headers.get("location") ?? "", ORIGIN);
    const code = loc.searchParams.get("code");
    const usid = loc.searchParams.get("usid");
    if (!code || !usid) return null;
    const t = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({ code, usid, code_verifier: verifier, grant_type: "authorization_code_pkce", redirect_uri: redirect, client_id: CLIENT, channel_id: SITE_ID }).toString(),
      signal: AbortSignal.timeout(8000),
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!t.ok) return null;
    return ((await t.json()) as any)?.access_token ?? null;
  } catch (err) {
    console.warn(`live-lookup: asics SLAS unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Map a Shopper Products record of one colour group. Pure. The record carries
 * the same `c_custom` block as a search hit: `price.model` (sales / list, USD),
 * `absolutePath` and `images`.
 */
export function mapAsicsProduct(p: any): LiveProduct | null {
  const c = p?.c_custom ?? {};
  const id = String(p?.id ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  const m = c.price?.model;
  const price = Number(m?.sales?.value ?? p?.price);
  const was = Number(m?.list?.value ?? c.tealiumDataLayer?.product_unit_original_price);
  const url = typeof c.absolutePath === "string" ? c.absolutePath : "";
  if (!/^ANA_/.test(id) || !name || !(price > 0) || !url.startsWith(`${ORIGIN}/us/en-us/`)) return null;
  const img = (Array.isArray(c.images) ? c.images : []).find((u: unknown) => typeof u === "string" && u.startsWith("https://")) ?? null;
  const g = String(c.productGender?.gender ?? p?.c_productGender ?? "").toLowerCase();
  const colour = c.tealiumDataLayer?.product_variant;
  return {
    brand: "asics",
    externalId: id,
    name,
    url,
    imageUrl: img,
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    inStock: p?.inventory?.orderable !== false,
    category: typeof p?.c_classification === "string" ? p.c_classification : null,
    type: null,
    gender: /kid|youth|child/.test(g) ? "cocuk" : g === "women" ? "kadin" : g === "men" ? "erkek" : null,
    colorName: typeof colour === "string" && colour ? colour : null,
    country: "US",
    currency: "USD",
  };
}

export async function asicsUrl(url: string): Promise<LiveProduct | null> {
  const id = asicsIdFromUrl(url);
  if (!id) return null;
  const country = countryFor("asics", "us");
  const token = await guestToken(country);
  if (!token) return null;
  const q = new URLSearchParams({ siteId: SITE_ID, locale: "en-US", currency: "USD", allImages: "false", expand: "prices,availability" });
  const body = await json<any>(
    `${HOST}/product/shopper-products/v1/organizations/${ORG}/products/${encodeURIComponent(id)}?${q}`,
    { Accept: "application/json", "User-Agent": UA, Authorization: `Bearer ${token}` },
    country,
  );
  return body ? mapAsicsProduct(body) : null;
}
