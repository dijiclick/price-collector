/**
 * ASICS United States (asics.com/us/en-us), plus GB and twelve EU shops
 * (2026-10-21, see ASICS_MARKETS).
 *
 * Akamai answers every asics.com page with "Access Denied" to GitHub runners,
 * the Hetzner box and the Mac (probe run 39134299441, 2026-10-18). The
 * storefront is a Salesforce PWA Kit app, and its page config publishes the
 * public Commerce API client (shortCode y841ero5, org f_ecom_bbtn_prd, client
 * 32c40d28-…, site asics-us). Salesforce's own API host is not behind the
 * brand's wall, so the collector does what the PWA does for a guest:
 *   1. SLAS PKCE guest login — GET `oauth2/authorize?hint=guest` answers 303
 *      with `code` + `usid`, POST `oauth2/token` turns it into a 30-minute
 *      shopper token (same flow as bloomingdales.ts).
 *   2. Shopper Search `product-search` on `cgid=AA60000000` (the site's Sale
 *      tree, 1,249 hits on 2026-10-18), 100 per page. Each hit is one colour
 *      (`variation_group`) and carries the shelf price ladder in
 *      `c_custom.price.model` — `sales` and `list`, USD major units.
 *   3. Shopper Products `products?ids=` (24 per call, expand availability — without
 *      it the variants carry no `orderable`) for per-size `orderable`
 *      flags, on the first SIZE_ROWS rows (women first) — restock alerts need
 *      sizes, and the search hit has none.
 *
 * Only rows with sales < list are kept (49 of the sale tree's hits had no list
 * price on 2026-10-18). OneASICS member events are prices every guest is shown
 * on the shelf, not opt-in codes; promotions (`c_custom.promotions`) are never read.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "asics";

const ORIGIN = "https://www.asics.com";
const SHORT = "y841ero5";
const ORG = "f_ecom_bbtn_prd";
const CLIENT = "32c40d28-93fc-4889-a473-14543e1cbcb5";
const SITE_ID = "asics-us";
const HOST = `https://${SHORT}.api.commercecloud.salesforce.com`;
const SALE_CGID = "AA60000000";

/**
 * GB + the EU shops (2026-10-21). The same SLAS client also logs in to two
 * more channels of the org: `asics-uk` (GBP) and `asics-eu` (one EU site; the
 * locale picks the path prefix and `currency` the price book — EUR, SEK, DKK).
 * Both have no "Sale" tree; their markdowns are the `outlet` catalogue
 * ("ASICS Outlet EU", asics.com/<cc>/<lang>/outlet/), 877 colours in GB and
 * 736 in the EU on 2026-10-21, every one with a list price above the sale
 * price on the shelf. The main `asics` catalogue carries no list prices at
 * all there. Australia and Japan are other platforms (no channel in this
 * org), not covered.
 */
export interface AsicsMarket { site: string; locale: string; currency: string; cgid: string; prefix: string }
const EU = (locale: string, currency = "EUR"): AsicsMarket => ({
  site: "asics-eu", locale, currency, cgid: "outlet", prefix: `${locale.slice(3).toLowerCase()}/${locale.toLowerCase()}`,
});
export const ASICS_MARKETS: Partial<Record<CountryCode, AsicsMarket>> = {
  US: { site: SITE_ID, locale: "en-US", currency: "USD", cgid: SALE_CGID, prefix: "us/en-us" },
  GB: { site: "asics-uk", locale: "en-GB", currency: "GBP", cgid: "outlet", prefix: "gb/en-gb" },
  FR: EU("fr-FR"),
  DE: EU("de-DE"),
  IT: EU("it-IT"),
  ES: EU("es-ES"),
  NL: EU("nl-NL"),
  BE: EU("fr-BE"),
  AT: EU("de-AT"),
  IE: EU("en-IE"),
  PT: EU("pt-PT"),
  FI: EU("fi-FI"),
  SE: EU("sv-SE", "SEK"),
  DK: EU("da-DK", "DKK"),
};
const US = ASICS_MARKETS.US!;
const PER_PAGE = 100;
const MAX_PAGES = 16;
const SIZE_BATCH = 24;
const SIZE_ROWS = 480;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf as Uint8Array).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** SLAS public-client guest login (PKCE). Returns a shopper access token. */
export async function guestToken(siteId = SITE_ID, country: CountryCode = "US"): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirect = `${ORIGIN}/callback`;
  const q = new URLSearchParams({
    redirect_uri: redirect, response_type: "code", client_id: CLIENT, hint: "guest",
    code_challenge: challenge, channel_id: siteId,
  });
  // The answer is a 303, so this call cannot go through getJson (it follows redirects).
  const res = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`, { redirect: "manual" });
  const loc = new URL(res.headers.get("location") ?? "", ORIGIN);
  const code = loc.searchParams.get("code");
  const usid = loc.searchParams.get("usid");
  if (!code || !usid) throw new Error(`asics: SLAS authorize gave ${res.status}`);
  const tok = await getJson<any>(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, usid, code_verifier: verifier, grant_type: "authorization_code_pkce",
      redirect_uri: redirect, client_id: CLIENT, channel_id: siteId,
    }).toString(),
    country,
  });
  if (!tok?.access_token) throw new Error("asics: no SLAS token");
  return tok.access_token;
}

export function searchUrl(offset: number, m: AsicsMarket = US): string {
  const q = new URLSearchParams({ siteId: m.site, locale: m.locale, currency: m.currency, limit: String(PER_PAGE), offset: String(offset) });
  q.append("refine", `cgid=${m.cgid}`);
  return `${HOST}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

export function productsUrl(ids: string[], m: AsicsMarket = US): string {
  const q = new URLSearchParams({ siteId: m.site, locale: m.locale, currency: m.currency, ids: ids.join(","), allImages: "false", expand: "availability,variations" });
  return `${HOST}/product/shopper-products/v1/organizations/${ORG}/products?${q}`;
}

const KID = /\b(kids?|kid's|youth|grade school|pre-?school|toddler|infant|gs|ps)\b/i;

export function genderOf(h: any): ProductRecord["gender"] {
  const g = String(h?.c_custom?.tealiumDataLayer?.plp_gender ?? "").toUpperCase();
  const label = `${h?.c_custom?.classification ?? ""} ${h?.productName ?? ""}`;
  if (g === "KIDS" || KID.test(label)) return "cocuk";
  if (g === "WOMEN") return "kadin";
  if (g === "MEN") return "erkek";
  return null;
}

/** Map one product-search hit. Pure; null unless the shelf price is a real reduction. */
export function mapAsics(h: any, country: CountryCode = "US"): ProductRecord | null {
  const mk = ASICS_MARKETS[country];
  if (!mk) return null;
  const c = h?.c_custom;
  const id = String(h?.productId ?? "");
  const name = String(h?.productName ?? "").replace(/\s+/g, " ").trim();
  const path = typeof c?.absolutePath === "string" ? c.absolutePath : "";
  if (!id || !name || !path.startsWith(`${ORIGIN}/${mk.prefix}/`)) return null;
  if (c?.isGiftCard) return null;
  const m = c?.price?.model;
  const sale = Number(m?.sales?.value ?? h?.price);
  const list = Number(m?.list?.value);
  if (!(sale > 0) || !Number.isFinite(list) || !(list > sale)) return null;
  if (h?.currency && h.currency !== mk.currency) return null;

  const photos: string[] = (Array.isArray(c?.images) ? c.images : []).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"));
  const first = photos[0] ?? (typeof h?.image?.link === "string" ? h.image.link : null);
  const swatches = Object.values(c?.swatches ?? {}) as any[];
  const colour = swatches.find((s) => s?.selected)?.name ?? null;
  const colours = [...new Set(swatches.map((s) => (typeof s?.name === "string" ? s.name.trim() : "")).filter(Boolean))];
  const category = typeof c?.classification === "string" && c.classification.trim() ? c.classification.replace(/\s+/g, " ").trim() : (c?.productArea ?? null);

  return {
    brand,
    country,
    externalId: id,
    // Model names are upper case on the site itself ("GEL-KAYANO 31"); kept as shown.
    name,
    url: path,
    imageUrl: first,
    images: cleanGallery(photos, first),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: mk.currency,
    inStock: h?.orderable !== false,
    category,
    gender: genderOf(h),
    variants: colour || colours.length ? { colors: colours.length ? colours : [String(colour)], sizes: [] } : null,
    groupKey: typeof c?.masterId === "string" && c.masterId ? `asics:${c.masterId}` : null,
    colorName: colour ? String(colour) : null,
  };
}

/** Per-size availability of one colour group from a Shopper Products record. Pure. */
export function sizesOf(p: any): SizeVariant[] {
  const colour = p?.variationValues?.color;
  const out = new Map<string, SizeVariant>();
  for (const v of p?.variants ?? []) {
    const vv = v?.variationValues ?? {};
    if (colour && vv.color && vv.color !== colour) continue;
    const size = String(vv.size ?? "").trim();
    if (!size) continue;
    const width = String(vv.width ?? "").trim();
    const label = width && !/^(standard|regular|medium|d|b)$/i.test(width) ? `${size} ${width}` : size;
    const availability = v?.orderable ? "in_stock" : "out_of_stock";
    const prev = out.get(label);
    if (!prev || (prev.availability === "out_of_stock" && availability === "in_stock")) out.set(label, { label, availability });
  }
  return [...out.values()];
}

export async function listAsics(country: CountryCode): Promise<ProductRecord[]> {
  const m = ASICS_MARKETS[country];
  if (!m) return [];
  const token = await guestToken(m.site, country);
  const auth = { Authorization: `Bearer ${token}` };
  const byId = new Map<string, ProductRecord>();
  let hits = 0;
  let total = Infinity;
  const problems: string[] = [];
  for (let page = 0; page < MAX_PAGES && page * PER_PAGE < total; page++) {
    if (page) await sleep(300);
    const data = await getJson<any>(searchUrl(page * PER_PAGE, m), { headers: auth, country, retries: 2 }).catch((e) => {
      problems.push(`p${page}: ${String(e).slice(0, 100)}`);
      return null;
    });
    if (!data) continue; // a 504 on one page loses that page, not the run
    total = Number(data.total ?? 0);
    for (const h of data.hits ?? []) {
      hits++;
      const r = mapAsics(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  if (!hits) throw new Error(`asics/${country}: the sale search returned no hits (${problems.slice(0, 3).join("; ") || `total ${total}`})`);

  const rank = (r: ProductRecord) => (r.gender === "kadin" ? 0 : r.gender == null ? 1 : r.gender === "erkek" ? 2 : 3);
  const ordered = [...byId.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock) || rank(a) - rank(b));
  const sizeIds = ordered.slice(0, SIZE_ROWS).map((r) => r.externalId);
  for (let i = 0; i < sizeIds.length; i += SIZE_BATCH) {
    await sleep(300);
    const d = await getJson<any>(productsUrl(sizeIds.slice(i, i + SIZE_BATCH), m), { headers: auth, country, retries: 1 }).catch(() => null);
    for (const p of d?.data ?? []) {
      const r = byId.get(String(p?.id ?? ""));
      const sizes = sizesOf(p);
      if (!r || !sizes.length) continue;
      r.variants = { colors: r.variants?.colors ?? (r.colorName ? [r.colorName] : []), sizes };
      if (!sizes.some((s) => s.availability !== "out_of_stock")) r.inStock = false;
    }
  }
  return ordered.sort((a, b) => Number(b.inStock) - Number(a.inStock)).slice(0, CAP);
}

export const listProducts = listAsics;
