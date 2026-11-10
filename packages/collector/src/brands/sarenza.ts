/**
 * Sarenza — French multi-brand shoe/fashion store (FR BE CH DE IT ES NL), 2026-11-10.
 *
 * The website (www.sarenza.com) is Cloudflare-walled for both this Mac and
 * GitHub runners (403 on every path). The data comes from the feed the Android
 * app (`com.sarenza`, React Native) uses: Salesforce Commerce Cloud Shopper
 * APIs on the vanity host `prodapp.sarenza.com`, organisation `f_ecom_bkmr_prd`,
 * sites `SarenzaFR/BE/CH/DE/IT/ES/NL`.
 *
 * 1. Guest token (SLAS public client, PKCE — the app's own flow, no account):
 *    `GET /shopper/auth/v1/…/oauth2/authorize?hint=guest…` → 303 with a code,
 *    then `POST …/oauth2/token` (grant `authorization_code_pkce`). 30-minute token.
 * 2. `GET /search/shopper-search/v1/…/product-search` with EXACTLY the app's
 *    expand set (`promotions,variations,prices,availability,custom_properties`
 *    + `perPricebook=true&allVariationProperties=true`). The store's search hook
 *    answers 500 "Hook Execution Error" for any lighter request, for `select=`,
 *    and 504 at `limit=200` (sometimes at 100 too); `limit=50` is used (~3 MB of
 *    JSON, ~1.5 s a page).
 *
 * A hit is one colour (`PCID_…`). The hook adds `c_extraInfo`: `price` (what
 * you pay, promotions applied), `c_crossedPrice` (the struck price the app
 * shows, null when not reduced), `c_hasMultiplePrice` (price differs by size —
 * skipped) and `c_seoUrl`. `variants[]` carry real per-size `orderable`.
 *
 * Sale-first: the event categories `soldes`, `blackfriday`, `promo` (same ids on
 * every site; empty ones are skipped), women first via the gender refinement
 * (`c_SARENZA_gender` 624 women / 625 men). Only rows with a crossed price above
 * the price are kept.
 *
 * Measured 2026-11-10 (Mac + runner probes 42802562380): blackfriday FR 26,521 ·
 * BE 24,518 · CH 14,658 (CHF) · DE 15,242 · IT 24,331 · ES 16,822 · NL 15,257;
 * each market answers the runner in its own currency. ≤ 28 search pages + 2
 * token calls a market (the hook leaves no lighter route).
 *
 * Unverified: the product-page URL (`/<cc>/<lang>/<c_seoUrl>`) could not be
 * opened from here or a runner (site wall); it is the app's share-link shape.
 */
import crypto from "node:crypto";
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const HOST = "https://prodapp.sarenza.com";
const ORG = "f_ecom_bkmr_prd";
/** The app's public SLAS client and its registered redirect (both in the app bundle). */
const CLIENT_ID = "9686145e-d8b3-4c3c-8058-5a4276b141cb";
const REDIRECT = "https://sarenza-pwa-ci.mobify-storefront.com/callback";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const SARENZA_MARKETS: Partial<Record<CountryCode, { site: string; locale: string; currency: string; path: string }>> = {
  FR: { site: "SarenzaFR", locale: "fr-FR", currency: "EUR", path: "/fr/fr" },
  BE: { site: "SarenzaBE", locale: "fr-BE", currency: "EUR", path: "/be/fr" },
  CH: { site: "SarenzaCH", locale: "fr-CH", currency: "CHF", path: "/ch/fr" },
  DE: { site: "SarenzaDE", locale: "de-DE", currency: "EUR", path: "/de/de" },
  IT: { site: "SarenzaIT", locale: "it-IT", currency: "EUR", path: "/it/it" },
  ES: { site: "SarenzaES", locale: "es-ES", currency: "EUR", path: "/es/es" },
  NL: { site: "SarenzaNL", locale: "nl-NL", currency: "EUR", path: "/nl/nl" },
};

const SALE_CATEGORIES = ["soldes", "blackfriday", "promo"];
const WALKS: { genderRefine: string; target: number; pages: number }[] = [
  { genderRefine: "624", target: 1100, pages: 22 },
  { genderRefine: "625", target: 300, pages: 6 },
];
const PAGE = 50;
const CAP = 1600;
const PAUSE_MS = Number(process.env.SARENZA_PAUSE_MS ?? 400);
const EXPAND = "expand=promotions,variations,prices,availability,custom_properties&perPricebook=true&allVariationProperties=true";

export interface SarenzaHit {
  productId?: string;
  productName?: string;
  currency?: string;
  orderable?: boolean;
  image?: { link?: string } | null;
  representedProduct?: {
    c_brand?: string;
    c_SARENZA_category_hierarchy_ids?: string;
    c_SARENZA_category_hierarchy_names?: string;
    c_SARENZA_PID?: string;
    c_SARENZA_supplier_color?: string;
  } | null;
  variants?: { orderable?: boolean; variationValues?: { size?: string } }[] | null;
  c_extraInfo?: {
    price?: number | null;
    c_crossedPrice?: number | null;
    c_hasMultiplePrice?: boolean;
    c_seoUrl?: string;
  } | null;
}

const GENDER: Record<string, ProductRecord["gender"]> = { "1": "kadin", "2": "erkek", "3": "cocuk" };

/** One search hit → a record, or null unless it carries a struck price above the price. Pure. */
export function mapSarenza(h: SarenzaHit, country: CountryCode): ProductRecord | null {
  const mk = SARENZA_MARKETS[country];
  const x = h.c_extraInfo;
  const id = h.productId;
  if (!mk || !x || !id || !h.productName || x.c_hasMultiplePrice) return null;
  const price = x.price ?? NaN;
  const was = x.c_crossedPrice ?? NaN;
  if (!(price > 0) || !(was > price)) return null;
  if (h.currency && h.currency !== mk.currency) return null;
  const rp = h.representedProduct ?? {};
  const maker = rp.c_brand?.trim() || null;
  const sizes: SizeVariant[] = [];
  for (const v of h.variants ?? []) {
    const label = v.variationValues?.size?.trim();
    if (!label) continue;
    const seen = sizes.find((s) => s.label === label);
    if (seen) {
      if (v.orderable) seen.availability = "in_stock";
    } else sizes.push({ label, availability: v.orderable ? "in_stock" : "out_of_stock" });
  }
  const names = (rp.c_SARENZA_category_hierarchy_names ?? "").split(">").map((s) => s.trim()).filter(Boolean);
  const top = (rp.c_SARENZA_category_hierarchy_ids ?? "").split(">")[0];
  const img = h.image?.link?.startsWith("https://") ? h.image.link : null;
  const seo = x.c_seoUrl?.replace(/^\/+/, "") || `${id}.html`;
  const name = h.productName.replace(/\s+/g, " ").trim();
  return {
    brand: "sarenza",
    country,
    externalId: id,
    name: maker && !name.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${name}` : name,
    url: `https://www.sarenza.com${mk.path}/${seo}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: mk.currency,
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : h.orderable !== false,
    category: names.length > 1 ? names.slice(1).join(" > ") : null,
    gender: GENDER[top] ?? null,
    maker,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: rp.c_SARENZA_PID ? `sarenza:${rp.c_SARENZA_PID}` : null,
    colorName: rp.c_SARENZA_supplier_color?.trim() || null,
  };
}

export function sarenzaSearchUrl(country: CountryCode, cgid: string, genderRefine: string, offset: number): string | null {
  const mk = SARENZA_MARKETS[country];
  if (!mk) return null;
  return (
    `${HOST}/search/shopper-search/v1/organizations/${ORG}/product-search?siteId=${mk.site}` +
    `&refine=cgid%3D${encodeURIComponent(cgid)}&refine=c_SARENZA_gender%3D${genderRefine}&refine=orderable_only%3Dtrue` +
    `&currency=${mk.currency}&locale=${mk.locale}&limit=${PAGE}&offset=${offset}&${EXPAND}`
  );
}

/** SLAS guest token for one site (public client + PKCE; the flow the app runs on first launch). */
export async function sarenzaGuestToken(site: string): Promise<string> {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const base = `${HOST}/shopper/auth/v1/organizations/${ORG}/oauth2`;
  const a = await fetch(
    `${base}/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&hint=guest&code_challenge=${challenge}&channel_id=${site}`,
    { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) },
  );
  const loc = a.headers.get("location");
  if (a.status !== 303 || !loc) throw new Error(`sarenza: authorize answered ${a.status}`);
  const q = new URL(loc).searchParams;
  const t = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({
      grant_type: "authorization_code_pkce",
      code: q.get("code") ?? "",
      usid: q.get("usid") ?? "",
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      channel_id: site,
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await t.json().catch(() => ({}))) as { access_token?: string };
  if (!t.ok || !j.access_token) throw new Error(`sarenza: token answered ${t.status}`);
  return j.access_token;
}

interface SearchResp { total?: number; hits?: SarenzaHit[] }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function listSarenza(
  country: CountryCode,
  deps: { token?: (site: string) => Promise<string>; search?: (url: string, token: string) => Promise<SearchResp> } = {},
): Promise<ProductRecord[]> {
  const mk = SARENZA_MARKETS[country];
  if (!mk) return [];
  const getToken = deps.token ?? sarenzaGuestToken;
  const search =
    deps.search ??
    ((url: string, token: string) =>
      getJson<SearchResp>(url, { country, retries: 2, headers: { Authorization: `Bearer ${token}`, "Accept-Language": mk.locale } }));
  const token = await getToken(mk.site);
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const walk of WALKS) {
    let got = 0;
    let pages = 0;
    for (const cgid of SALE_CATEGORIES) {
      for (let offset = 0; got < walk.target && pages < walk.pages; offset += PAGE) {
        if (calls++) await sleep(PAUSE_MS);
        pages++;
        let j: SearchResp;
        try {
          j = await search(sarenzaSearchUrl(country, cgid, walk.genderRefine, offset)!, token);
        } catch (err) {
          if (byId.size === 0 && calls === 1) throw err;
          break;
        }
        const hits = j.hits ?? [];
        for (const h of hits) {
          const r = mapSarenza(h, country);
          if (!r || byId.has(r.externalId)) continue;
          byId.set(r.externalId, r);
          got++;
        }
        if (hits.length < PAGE || offset + PAGE >= (j.total ?? 0)) break;
      }
      if (got >= walk.target || pages >= walk.pages) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`sarenza/${country}: ${calls} search pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
