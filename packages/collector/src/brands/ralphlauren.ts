/**
 * Ralph Lauren (ralphlauren.com Sale, ralphlauren.ca Sale) — US and Canada.
 *
 * Measured 2026-10-18: www.ralphlauren.com, .ca and the app's own API host
 * (rldapi.ralphlauren.com, OCAPI behind a custom domain) all sit behind
 * PerimeterX/HUMAN (appId PXjBdHNCWl): 307 captcha for browsers, curl,
 * okhttp and headless Chrome alike, from GitHub runners, the Hetzner box and
 * the Mac. The Android app (com.ralphlauren.us.app 4.8.4, React Native) also
 * talks to Salesforce's own SCAPI host, `7gxbizjm.api.commercecloud.salesforce.com`
 * (org f_ecom_bbxf_prd, public SLAS client 7bedfbcb-…, redirect
 * `https://www.ralphlauren.com/slasrlapp` — all from the app's bundled config),
 * which is not behind PerimeterX. The collector does what the app does for a
 * guest, as bloomingdales.ts does:
 *   1. SLAS PKCE guest login (authorize 303 → token), a 30-minute token.
 *   2. Shopper Search `product-search` on the site's Sale tree per gender
 *      (`sale-women`, `sale-men`, `sale-kids`; `-ca` ids on the CA site), 200 hits
 *      a page, with `perPricebook=true` so every variant carries both pricebooks:
 *      `ralphlauren-us-usd-list-prices` (the regular price) and
 *      `…-sale-prices` (the marked-down price). Those are pricebook prices, not
 *      coupons or member prices.
 * One row per style, in the colour the hit represents (its image is that
 * colour's photo; search hits carry no per-colour images). The row is kept only
 * when every size of that colour has one list price and one sale price, and the
 * sale price is lower. Variants carry `orderable` per size = per-size stock.
 * Home (sale-home) is left out.
 *
 * Product pages: `https://www.ralphlauren.com/<variantId>.html` — SFCC resolves
 * the product by the id before `.html` (the app shares `<site>/<id>.html`; the
 * API's own `slugUrl` for a variant ends in `/<variantId>.html`).
 *
 * About 6 search pages (~8 s each) + 2 auth calls per market.
 */
import { type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "ralphlauren";

const HOST = "https://7gxbizjm.api.commercecloud.salesforce.com";
const ORG = "f_ecom_bbxf_prd";
const CLIENT = "7bedfbcb-e80a-41ed-a65a-8ff08ffa0333";
const PER_PAGE = 200;

export const MARKETS: Partial<Record<CountryCode, { siteId: string; site: string; currency: string; locale: string; suffix: string }>> = {
  US: { siteId: "RalphLauren_US", site: "https://www.ralphlauren.com", currency: "USD", locale: "en-US", suffix: "" },
  CA: { siteId: "RalphLauren_CA", site: "https://www.ralphlauren.ca", currency: "CAD", locale: "en-CA", suffix: "-ca" },
};

/** Gender walks over the Sale tree and their page budget (200 hits a page). */
export const WALKS: { cgid: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { cgid: "sale-women", gender: "kadin", pages: 4 },
  { cgid: "sale-men", gender: "erkek", pages: 2 },
  { cgid: "sale-kids", gender: "cocuk", pages: 3 },
];

const tier = (v: any, kind: "list" | "sale"): number | null => {
  const t = (v?.tieredPrices ?? []).find((p: any) => typeof p?.pricebook === "string" && p.pricebook.endsWith(`-${kind}-prices`));
  const n = Number(t?.price);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const SIZE_KEYS = (vals: Record<string, unknown>) => Object.keys(vals).filter((k) => k !== "colorname");

const LETTER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "1X", "2X", "3X", "4X"];
/** Shelf order: letter sizes (petite/tall suffixes too), then numbers, then the rest. */
export function sizeRank(label: string): number {
  const first = label.split(" / ")[0].trim().toUpperCase();
  const i = LETTER.indexOf(first.replace(/(?<=S|M|L|X)[PT]$/, ""));
  if (i >= 0) return i;
  const n = parseFloat(first);
  return Number.isFinite(n) ? 100 + n : 10000;
}

/**
 * Map one Shopper Search hit (expand=prices,variations,availability,
 * perPricebook=true) to a row for its represented colour. Pure.
 * `onlyDiscounted` false keeps a full-price row (the resolver).
 */
export function mapRalphLauren(h: any, country: CountryCode, gender: ProductRecord["gender"], onlyDiscounted = true): ProductRecord | null {
  const m = MARKETS[country];
  if (!m) return null;
  const master = String(h?.productId ?? "");
  const repId = String(h?.representedProduct?.id ?? "");
  const name = String(h?.productName ?? "").replace(/\s+/g, " ").trim();
  if (!master || !repId || !name) return null;
  if (h?.currency && h.currency !== m.currency) return null;
  const variants: any[] = h?.variants ?? [];
  const rep = variants.find((v) => String(v?.productId) === repId);
  const colour = rep?.variationValues?.colorname ? String(rep.variationValues.colorname) : null;
  const mine = colour ? variants.filter((v) => v?.variationValues?.colorname === colour) : rep ? [rep] : [];
  if (!mine.length) return null;
  const lists = new Set(mine.map((v) => tier(v, "list")));
  const sales = new Set(mine.map((v) => tier(v, "sale") ?? Number(v?.price)));
  if (lists.size !== 1 || sales.size !== 1) return null; // a range across sizes, not one price
  const list = [...lists][0];
  const price = [...sales][0];
  if (!(price > 0)) return null;
  const discounted = list != null && list > price + 0.005;
  if (onlyDiscounted && !discounted) return null;
  const sizes: SizeVariant[] = mine.map((v) => {
    const vals = v?.variationValues ?? {};
    const label = SIZE_KEYS(vals).map((k) => String(vals[k])).join(" / ") || "One Size";
    return { label, availability: v?.orderable === false ? "out_of_stock" : "in_stock" } as SizeVariant;
  }).sort((a, b) => sizeRank(a.label) - sizeRank(b.label));
  const img = typeof h?.image?.link === "string" ? h.image.link : null;
  return {
    brand,
    country,
    externalId: repId,
    name,
    url: `${m.site}/${repId}.html`,
    imageUrl: img,
    images: img ? [img] : null,
    price: toMinor(price),
    listPrice: discounted ? toMinor(list!) : null,
    currency: m.currency,
    inStock: mine.some((v) => v?.orderable !== false),
    category: null,
    gender,
    variants: { colors: colour ? [colour] : [], sizes },
    groupKey: `ralphlauren:${master}`,
    colorName: colour,
  };
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf as Uint8Array).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SLAS public-client guest login (PKCE), as the app does. Returns a shopper token. */
export async function guestToken(country: CountryCode): Promise<string> {
  const m = MARKETS[country]!;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirect = `${m.site}/slasrlapp`;
  const q = new URLSearchParams({
    redirect_uri: redirect, response_type: "code", client_id: CLIENT, hint: "guest",
    code_challenge: challenge, channel_id: m.siteId,
  });
  // The answer is a 303, so this one call cannot go through getJson.
  const res = await fetch(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/authorize?${q}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const loc = new URL(res.headers.get("location") ?? "", m.site);
  const code = loc.searchParams.get("code");
  const usid = loc.searchParams.get("usid");
  if (!code || !usid) throw new Error(`ralphlauren/${country}: SLAS authorize gave ${res.status}`);
  const tok = await getJson<any>(`${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, usid, code_verifier: verifier, grant_type: "authorization_code_pkce",
      redirect_uri: redirect, client_id: CLIENT, channel_id: m.siteId,
    }).toString(),
    country,
  });
  if (!tok?.access_token) throw new Error(`ralphlauren/${country}: no SLAS token`);
  return tok.access_token;
}

export function searchUrl(country: CountryCode, cgid: string, offset: number): string {
  const m = MARKETS[country]!;
  const q = new URLSearchParams({
    siteId: m.siteId, locale: m.locale, currency: m.currency, limit: String(PER_PAGE), offset: String(offset),
    refine: `cgid=${cgid}${m.suffix}`, expand: "prices,variations,availability,images", perPricebook: "true",
    // Without this the hit has no `variants` (so no per-size price or stock).
    allVariationProperties: "true",
  });
  return `${HOST}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`;
}

/** Shopper Products lookup of one product (master or variant id) — the resolver's call. */
export function productUrl(country: CountryCode, id: string): string {
  const m = MARKETS[country]!;
  const q = new URLSearchParams({
    siteId: m.siteId, locale: m.locale, currency: m.currency,
    expand: "prices,variations,availability,images", perPricebook: "true",
  });
  return `${HOST}/product/shopper-products/v1/organizations/${ORG}/products/${encodeURIComponent(id)}?${q}`;
}

export async function listRalphLauren(country: CountryCode): Promise<ProductRecord[]> {
  if (!MARKETS[country]) return [];
  const token = await guestToken(country);
  const byId = new Map<string, ProductRecord>();
  let ok = 0;
  let lastErr: unknown = null;
  for (const w of WALKS) {
    for (let page = 0; page < w.pages; page++) {
      const data = await getJson<any>(searchUrl(country, w.cgid, page * PER_PAGE), {
        headers: { Authorization: `Bearer ${token}` },
        country,
        retries: 1,
      }).catch((e) => {
        lastErr = e;
        return null;
      });
      if (!data) break;
      ok++;
      const hits: any[] = data.hits ?? [];
      for (const h of hits) {
        const r = mapRalphLauren(h, country, w.gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (hits.length < PER_PAGE || (page + 1) * PER_PAGE >= Number(data.total ?? 0)) break;
    }
  }
  if (!ok) throw new Error(`ralphlauren/${country}: every search failed — ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  const all = [...byId.values()];
  if (!all.length) throw new Error(`ralphlauren/${country}: 0 discounted products in Sale`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, 1500);
}

export const listProducts = listRalphLauren;
