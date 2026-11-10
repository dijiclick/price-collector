/**
 * Mytheresa by url (`mytheresa.com/<store>/<lang>/<women|men|kids>/<slug>-p01234567`).
 * The website is bot-walled; the apps' GraphQL API (`api.mytheresa.com/api`,
 * store in `X-Store`) answers one product by slug — the same source as the
 * collector (packages/collector/src/brands/mytheresa.ts). Amounts are minor
 * units, except JPY/KRW (whole units, stored ×100).
 */
import type { LiveProduct } from "../live-lookup";
import type { CountryCode } from "../countries";
import { UA } from "../live-http";

const API = "https://api.mytheresa.com/api";

/** Url store segment → the market it is quoted for and its currency (the collector's MYTHERESA_MARKETS). */
export const MYTHERESA_STORES: Record<string, { country: CountryCode; currency: string }> = {
  us: { country: "US", currency: "USD" }, ca: { country: "CA", currency: "CAD" }, gb: { country: "GB", currency: "GBP" },
  de: { country: "DE", currency: "EUR" }, it: { country: "IT", currency: "EUR" }, nl: { country: "NL", currency: "EUR" }, at: { country: "AT", currency: "EUR" },
  euro: { country: "ES", currency: "EUR" }, ch: { country: "CH", currency: "CHF" }, au: { country: "AU", currency: "AUD" },
  jp: { country: "JP", currency: "JPY" }, kr: { country: "KR", currency: "KRW" }, sg: { country: "SG", currency: "SGD" }, hk: { country: "HK", currency: "HKD" },
};

export function mytheresaTarget(url: string): { store: string; section: string; slug: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)mytheresa\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/([a-z]{2,4})\/[a-z]{2}\/([a-z]+)\/([a-z0-9-]+-p\d{6,})(?:\.html)?\/?$/i);
  if (!m || !MYTHERESA_STORES[m[1].toLowerCase()]) return null;
  // Localised department words (damen, femme, donna …) all sit in the women's store unless they name men/kids.
  const dept = m[2].toLowerCase();
  const section = /^(men|herren|homme|uomo|hombre)$/.test(dept) ? "men" : /^(kids|kinder|enfant|bambini)/.test(dept) ? "kids" : "women";
  return { store: m[1].toLowerCase(), section, slug: m[3].toLowerCase() };
}

const QUERY = `query xProductQuery($slug: String!) {
  xProduct(slug: $slug) {
    sku name color designer department combinedCategoryName displayImages hasStock
    price { currencyCode discount original }
    variants { size availability { hasStock } }
  }
}`;

/** Map an `xProduct` body. Pure. */
export function mapMytheresaProduct(body: any, store: string, url: string): LiveProduct | null {
  const p = body?.data?.xProduct;
  const market = MYTHERESA_STORES[store];
  const title = String(p?.name ?? "").trim();
  if (!p?.sku || !title || !market || String(p?.price?.currencyCode ?? "") !== market.currency) return null;
  const scale = market.currency === "JPY" || market.currency === "KRW" ? 100 : 1;
  const sale = Math.round(Number(p.price.discount) * scale);
  const regular = Math.round(Number(p.price.original) * scale);
  const price = sale > 0 ? sale : regular;
  if (!(price > 0)) return null;
  const make = String(p.designer ?? "").trim();
  const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
  const dept = String(p.department ?? "").toLowerCase();
  const cats = String(p.combinedCategoryName ?? "").split("::").map((s) => s.trim()).filter(Boolean);
  const img = Array.isArray(p.displayImages) && typeof p.displayImages[0] === "string" ? p.displayImages[0] : null;
  return {
    brand: "mytheresa",
    externalId: String(p.sku),
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url,
    imageUrl: img,
    price,
    listPrice: regular > price ? regular : null,
    inStock: variants.length ? variants.some((v) => v?.availability?.hasStock === true) : p.hasStock !== false,
    category: cats.length ? cats[cats.length - 1].toLowerCase() : null,
    type: null,
    gender: dept === "men" ? "erkek" : dept === "kids" ? "cocuk" : dept === "women" ? "kadin" : null,
    colorName: typeof p.color === "string" && p.color.trim() ? p.color.trim() : null,
    country: market.country,
    currency: market.currency,
  };
}

export async function mytheresaUrl(url: string): Promise<LiveProduct | null> {
  const hit = mytheresaTarget(url);
  if (!hit) return null;
  const clean = (() => { const u = new URL(url); u.search = ""; u.hash = ""; return u.toString(); })();
  const market = MYTHERESA_STORES[hit.store];
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, "Accept-Language": "en",
        "X-Store": hit.store.toUpperCase(), "X-Country": market.country, "X-Section": hit.section,
      },
      body: JSON.stringify({ query: QUERY, variables: { slug: hit.slug } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) {
      console.warn(`live-lookup: api.mytheresa.com refused with HTTP ${r.status}`);
      return null;
    }
    return mapMytheresaProduct(await r.json(), hit.store, clean);
  } catch (err) {
    console.warn(`live-lookup: api.mytheresa.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
