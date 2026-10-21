/**
 * Bloomingdale's Dubai (bloomingdales.ae, Al Tayer) — UAE, and since
 * 2026-10-21 Kuwait (bloomingdales.com.kw: the same SCAPI org and public
 * client, site `BloomingDales_KW`, prices in KWD).
 *
 * Measured 2026-10-11: a Salesforce PWA Kit storefront whose page config
 * publishes the public SCAPI client (`commerceAPI.parameters` in the HTML).
 * The collector does what the PWA does for a guest:
 *   1. SLAS PKCE guest login — GET `oauth2/authorize?hint=guest` answers 303
 *      with `code` + `usid` in the Location, POST `oauth2/token` turns it into
 *      a 30-minute shopper token. No cookie, no captcha.
 *   2. Shopper Search `product-search` on `cgid=sale-public` (the site's sale
 *      tree, ~5.1k hits) refined by `c_gender`, so gender is known per walk and
 *      Home is left out. Each hit carries `c_price.sales` / `c_price.list` in
 *      AED.
 * The search answers slowly (~13 s per 100 hits, 504 at 200), so the walk is
 * 10 pages of 100 split across genders — about 2 minutes. Hits carry no
 * per-size stock, so no size variants.
 *
 * Product pages are `/<anything>-<representedProductId>.html` (the sitemap's
 * form; the slug part is not checked).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

/** Per market: storefront, SCAPI site id, locale and the currency it prices in. */
export const BLOOMINGDALES_MARKETS: Partial<Record<CountryCode, { site: string; siteId: string; locale: string; currency: string }>> = {
  AE: { site: "https://bloomingdales.ae", siteId: "BloomingDales_AE", locale: "en-AE", currency: "AED" },
  KW: { site: "https://bloomingdales.com.kw", siteId: "BloomingDales_KW", locale: "en-KW", currency: "KWD" },
};
const SHORT = "cfcgu8kp";
const ORG = "f_ecom_bljm_prd";
const CLIENT = "a527050f-fa90-4a90-9950-8edd4cd5eb53";
const HOST = `https://${SHORT}.api.commercecloud.salesforce.com`;
const PER_PAGE = 100;

/** Gender walks and their page budget (10 pages ≈ 2 min at ~13 s a page). */
export const WALKS: { refine: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { refine: "c_gender=Womens", gender: "kadin", pages: 5 },
  { refine: "c_gender=Mens", gender: "erkek", pages: 3 },
  { refine: "c_gender=Girl|Boy|Kids", gender: "cocuk", pages: 1 },
  { refine: "c_gender=Unisex", gender: null, pages: 1 },
];

export const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Map one product-search hit. Pure. */
export function mapBloomingdales(h: any, gender: ProductRecord["gender"], country: CountryCode = "AE"): ProductRecord | null {
  const m = BLOOMINGDALES_MARKETS[country];
  if (!m) return null;
  const sale = Number(h?.c_price?.sales?.value ?? h?.price);
  const list = Number(h?.c_price?.list?.value);
  const id = String(h?.productId ?? "");
  const rep = String(h?.c_represented_product_id ?? h?.representedProduct?.id ?? "");
  const title = String(h?.c_name_en ?? h?.productName ?? "").replace(/\s+/g, " ").trim();
  if (!id || !rep || !title || !(sale > 0)) return null;
  if (h?.currency && h.currency !== m.currency) return null;
  const brand = h?.c_brand ? String(h.c_brand).trim() : "";
  const imgs: string[] = (h?.c_images ?? []).map((i: any) => i?.absURL ?? i?.url).filter((u: unknown) => typeof u === "string");
  const first = h?.c_image?.absURL ?? imgs[0] ?? h?.image?.disBaseLink ?? null;
  const colour = (h?.c_colors ?? []).find((c: any) => c?.selected)?.text ?? null;
  return {
    brand: "bloomingdales",
    country,
    externalId: id,
    name: brand ? `${brand} ${title}` : title,
    url: `${m.site}/${slugify(`${brand} ${title}`)}-${rep}.html`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(sale),
    listPrice: Number.isFinite(list) && list > sale ? toMinor(list) : null,
    currency: m.currency,
    inStock: h?.orderable !== false && h?.c_nonBuyable !== true,
    category: null,
    gender,
    variants: colour ? { colors: [String(colour)], sizes: [] } : null,
    groupKey: h?.c_masterId ? `bloomingdales:${h.c_masterId}` : null,
    colorName: colour ? String(colour) : null,
  };
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf as Uint8Array).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SLAS public-client guest login (PKCE). Returns a shopper access token. */
export async function guestToken(country: CountryCode = "AE"): Promise<string> {
  const { site, siteId } = BLOOMINGDALES_MARKETS[country]!;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirect = `${site}/callback`;
  const q = new URLSearchParams({
    redirect_uri: redirect, response_type: "code", client_id: CLIENT, hint: "guest",
    code_challenge: challenge, channel_id: siteId,
  });
  // A 303 is the answer here, so this one call cannot go through getJson.
  const res = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`, { redirect: "manual" });
  const loc = new URL(res.headers.get("location") ?? "", site);
  const code = loc.searchParams.get("code");
  const usid = loc.searchParams.get("usid");
  if (!code || !usid) throw new Error(`bloomingdales: SLAS authorize gave ${res.status}`);
  const tok = await getJson<any>(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, usid, code_verifier: verifier, grant_type: "authorization_code_pkce",
      redirect_uri: redirect, client_id: CLIENT, channel_id: siteId,
    }).toString(),
    country,
  });
  if (!tok?.access_token) throw new Error("bloomingdales: no SLAS token");
  return tok.access_token;
}

export function searchUrl(refine: string, offset: number, country: CountryCode = "AE"): string {
  const m = BLOOMINGDALES_MARKETS[country]!;
  const q = new URLSearchParams({ siteId: m.siteId, locale: m.locale, currency: m.currency, limit: String(PER_PAGE), offset: String(offset) });
  q.append("refine", "cgid=sale-public");
  q.append("refine", refine);
  return `${HOST}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

export const brand = "bloomingdales";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  if (!BLOOMINGDALES_MARKETS[country]) return [];
  const token = await guestToken(country);
  const byId = new Map<string, ProductRecord>();
  for (const w of WALKS) {
    for (let page = 0; page < w.pages; page++) {
      const data = await getJson<any>(searchUrl(w.refine, page * PER_PAGE, country), {
        headers: { Authorization: `Bearer ${token}` },
        country,
        retries: 1,
      }).catch(() => null);
      const hits: any[] = data?.hits ?? [];
      for (const h of hits) {
        const r = mapBloomingdales(h, w.gender, country);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (hits.length < PER_PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}
