/**
 * Bloomingdale's Dubai (bloomingdales.ae, Al Tayer) — UAE only.
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

const SITE = "https://bloomingdales.ae";
const SHORT = "cfcgu8kp";
const ORG = "f_ecom_bljm_prd";
const CLIENT = "a527050f-fa90-4a90-9950-8edd4cd5eb53";
const SITE_ID = "BloomingDales_AE";
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
export function mapBloomingdales(h: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const sale = Number(h?.c_price?.sales?.value ?? h?.price);
  const list = Number(h?.c_price?.list?.value);
  const id = String(h?.productId ?? "");
  const rep = String(h?.c_represented_product_id ?? h?.representedProduct?.id ?? "");
  const title = String(h?.c_name_en ?? h?.productName ?? "").replace(/\s+/g, " ").trim();
  if (!id || !rep || !title || !(sale > 0)) return null;
  if (h?.currency && h.currency !== "AED") return null;
  const brand = h?.c_brand ? String(h.c_brand).trim() : "";
  const imgs: string[] = (h?.c_images ?? []).map((i: any) => i?.absURL ?? i?.url).filter((u: unknown) => typeof u === "string");
  const first = h?.c_image?.absURL ?? imgs[0] ?? h?.image?.disBaseLink ?? null;
  const colour = (h?.c_colors ?? []).find((c: any) => c?.selected)?.text ?? null;
  return {
    brand: "bloomingdales",
    country: "AE",
    externalId: id,
    name: brand ? `${brand} ${title}` : title,
    url: `${SITE}/${slugify(`${brand} ${title}`)}-${rep}.html`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(sale),
    listPrice: Number.isFinite(list) && list > sale ? toMinor(list) : null,
    currency: "AED",
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
export async function guestToken(): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirect = `${SITE}/callback`;
  const q = new URLSearchParams({
    redirect_uri: redirect, response_type: "code", client_id: CLIENT, hint: "guest",
    code_challenge: challenge, channel_id: SITE_ID,
  });
  // A 303 is the answer here, so this one call cannot go through getJson.
  const res = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`, { redirect: "manual" });
  const loc = new URL(res.headers.get("location") ?? "", SITE);
  const code = loc.searchParams.get("code");
  const usid = loc.searchParams.get("usid");
  if (!code || !usid) throw new Error(`bloomingdales: SLAS authorize gave ${res.status}`);
  const tok = await getJson<any>(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, usid, code_verifier: verifier, grant_type: "authorization_code_pkce",
      redirect_uri: redirect, client_id: CLIENT, channel_id: SITE_ID,
    }).toString(),
    country: "AE",
  });
  if (!tok?.access_token) throw new Error("bloomingdales: no SLAS token");
  return tok.access_token;
}

export function searchUrl(refine: string, offset: number): string {
  const q = new URLSearchParams({ siteId: SITE_ID, locale: "en-AE", currency: "AED", limit: String(PER_PAGE), offset: String(offset) });
  q.append("refine", "cgid=sale-public");
  q.append("refine", refine);
  return `${HOST}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

export const brand = "bloomingdales";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AE") return [];
  const token = await guestToken();
  const byId = new Map<string, ProductRecord>();
  for (const w of WALKS) {
    for (let page = 0; page < w.pages; page++) {
      const data = await getJson<any>(searchUrl(w.refine, page * PER_PAGE), {
        headers: { Authorization: `Bearer ${token}` },
        country,
        retries: 1,
      }).catch(() => null);
      const hits: any[] = data?.hits ?? [];
      for (const h of hits) {
        const r = mapBloomingdales(h, w.gender);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (hits.length < PER_PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}
