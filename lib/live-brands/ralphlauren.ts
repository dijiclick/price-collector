/**
 * Ralph Lauren by url (`ralphlauren.com/<…>/<id>.html`, also ralphlauren.ca).
 * The site and the app's rldapi host are behind PerimeterX, so — like the
 * collector (packages/collector/src/brands/ralphlauren.ts) — this reads
 * Salesforce's own SCAPI host with the app's public SLAS guest client:
 * authorize (303) → token, then Shopper Products `products/<id>` with
 * `perPricebook=true`, whose variants carry both the list and the sale
 * pricebook price. The id is a variant id (colour + size, what the collector
 * stores and links) or a master id; the colour of the variant picks the row.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json } from "../live-http";

const HOST = "https://7gxbizjm.api.commercecloud.salesforce.com";
const ORG = "f_ecom_bbxf_prd";
const CLIENT = "7bedfbcb-e80a-41ed-a65a-8ff08ffa0333";
const MARKETS = {
  US: { host: "ralphlauren.com", siteId: "RalphLauren_US", site: "https://www.ralphlauren.com", currency: "USD", locale: "en-US" },
  CA: { host: "ralphlauren.ca", siteId: "RalphLauren_CA", site: "https://www.ralphlauren.ca", currency: "CAD", locale: "en-CA" },
} as const;
type Market = keyof typeof MARKETS;

export function ralphLaurenRefFromUrl(url: string): { country: Market; id: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  const country = (Object.keys(MARKETS) as Market[]).find((c) => h === MARKETS[c].host);
  if (!country) return null;
  const id = u.pathname.match(/\/([A-Za-z0-9-]+)\.html$/)?.[1];
  // Product ids are digits (masters 9, variants 10) or styles like 401480-P.
  if (!id || !/\d{6,}/.test(id)) return null;
  return { country, id };
}

const tier = (v: any, kind: "list" | "sale"): number | null => {
  const t = (v?.tieredPrices ?? []).find((p: any) => typeof p?.pricebook === "string" && p.pricebook.endsWith(`-${kind}-prices`));
  const n = Number(t?.price);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toMinor = (n: number) => Math.round(n * 100);

/** Map a Shopper Products body (variant or master). Pure. */
export function mapRalphLaurenProduct(p: any, country: Market): LiveProduct | null {
  const m = MARKETS[country];
  const id = String(p?.id ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  if (!id || !name) return null;
  const variants: any[] = p?.variants ?? [];
  const self = variants.find((v) => String(v?.productId) === id);
  const pick = self ?? variants.filter((v) => v?.orderable).sort((a, b) => (tier(a, "sale") ?? a.price) - (tier(b, "sale") ?? b.price))[0] ?? variants[0];
  const colour = pick?.variationValues?.colorname ?? p?.variationValues?.colorname ?? null;
  const mine = colour ? variants.filter((v) => v?.variationValues?.colorname === colour) : pick ? [pick] : [];
  const prices = mine.map((v) => tier(v, "sale") ?? Number(v?.price)).filter((n) => n > 0);
  const lists = mine.map((v) => tier(v, "list")).filter((n): n is number => n != null);
  const price = prices.length ? Math.max(...prices) : Number(p?.price);
  if (!(price > 0)) return null;
  const list = lists.length ? Math.max(...lists) : null;
  const groups: any[] = p?.imageGroups ?? [];
  const forColour = groups.filter((g) => !colour || (g?.variationAttributes ?? []).some((a: any) => a?.id === "colorname" && (a.values ?? []).some((x: any) => x?.value === colour)));
  const img =
    forColour.find((g) => g?.viewType === "lifestyle")?.images?.[0]?.link ??
    forColour[0]?.images?.[0]?.link ??
    groups[0]?.images?.[0]?.link ?? null;
  const outId = pick?.productId ? String(pick.productId) : id;
  return {
    brand: "ralphlauren",
    externalId: outId,
    name,
    url: `${m.site}/${outId}.html`,
    imageUrl: img,
    price: toMinor(price),
    listPrice: list != null && list > price + 0.005 ? toMinor(list) : null,
    inStock: mine.length ? mine.some((v) => v?.orderable !== false) : p?.inventory?.orderable === true,
    category: null,
    type: null,
    gender: p?.c_PoloDivision === "Women" ? "kadin" : p?.c_PoloDivision === "Men" ? "erkek" : /kid|boy|girl|baby/i.test(String(p?.c_PoloDivision ?? "")) ? "cocuk" : null,
    colorName: colour ? String(colour) : null,
    country,
    currency: m.currency,
  };
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf as Uint8Array).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const tokens = new Map<Market, { token: string; until: number }>();

async function guestToken(country: Market): Promise<string | null> {
  const hit = tokens.get(country);
  if (hit && hit.until > Date.now()) return hit.token;
  const m = MARKETS[country];
  try {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const redirect = `${m.site}/slasrlapp`;
    const q = new URLSearchParams({ redirect_uri: redirect, response_type: "code", client_id: CLIENT, hint: "guest", code_challenge: challenge, channel_id: m.siteId });
    const a = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const loc = new URL(a.headers.get("location") ?? "", m.site);
    const code = loc.searchParams.get("code");
    const usid = loc.searchParams.get("usid");
    if (!code || !usid) { console.warn(`live-lookup: ralphlauren SLAS authorize gave HTTP ${a.status}`); return null; }
    const t = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({ code, usid, code_verifier: verifier, grant_type: "authorization_code_pkce", redirect_uri: redirect, client_id: CLIENT, channel_id: m.siteId }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    const j: any = t.ok ? await t.json() : null;
    if (!j?.access_token) { console.warn(`live-lookup: ralphlauren SLAS token gave HTTP ${t.status}`); return null; }
    tokens.set(country, { token: j.access_token, until: Date.now() + 25 * 60_000 });
    return j.access_token;
  } catch (err) {
    console.warn(`live-lookup: ralphlauren SLAS unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function ralphlaurenUrl(url: string): Promise<LiveProduct | null> {
  const ref = ralphLaurenRefFromUrl(url);
  if (!ref) return null;
  const token = await guestToken(ref.country);
  if (!token) return null;
  const m = MARKETS[ref.country];
  const q = new URLSearchParams({ siteId: m.siteId, locale: m.locale, currency: m.currency, expand: "prices,variations,availability,images", perPricebook: "true" });
  const body = await json<any>(
    `${HOST}/product/shopper-products/v1/organizations/${ORG}/products/${encodeURIComponent(ref.id)}?${q}`,
    { Accept: "application/json", "User-Agent": UA, Authorization: `Bearer ${token}` },
    countryFor("ralphlauren", ref.country),
  );
  return body ? mapRalphLaurenProduct(body, ref.country) : null;
}
