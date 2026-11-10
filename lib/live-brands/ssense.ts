/**
 * SSENSE by url (`ssense.com/en-ca/<women|men>/product/<brand>/<slug>/<id>`).
 * The website is Cloudflare-challenged; the Android app's GraphQL federation
 * (`constellation.ssense.com/graphql`, only an `x-client-version` header)
 * answers one product by id — the same source and id as the collector
 * (packages/collector/src/brands/ssense.ts). Prices are whole units of the
 * market's currency; `lowestPrice(discountNames: [])` is the public price (no
 * private-sale tags). The market is the url's `/en-<cc>/` prefix when SSENSE
 * prices that country in its own currency (SSENSE_CURRENCY), else Canada.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, usingProxy } from "../live-http";

const API = "https://constellation.ssense.com/graphql";
const IMG = "c_scale,h_960/f_auto,q_auto";

/** Markets SSENSE prices in their own currency (the collector's SSENSE_MARKETS). */
export const SSENSE_CURRENCY: Record<string, string> = {
  CA: "CAD", US: "USD", GB: "GBP", AU: "AUD", JP: "JPY", HK: "HKD",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", IE: "EUR", PT: "EUR", FI: "EUR",
};

/** The market a pasted url is for: `/en-gb/`, `/fr-fr/`, `/ja-jp/` → GB, FR, JP; anything else Canada. */
export function ssenseCountryFromUrl(url: string): string {
  try {
    const cc = new URL(url).pathname.match(/^\/[a-z]{2}-([a-z]{2})\//i)?.[1]?.toUpperCase();
    return cc && SSENSE_CURRENCY[cc] ? cc : "CA";
  } catch { return "CA"; }
}

export function ssenseIdFromUrl(url: string): { id: string; section: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)ssense\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(women|men|everything-else)\/product\/[^/]+\/[^/]+\/(\d{5,})\/?$/i);
  return m ? { id: m[2], section: m[1].toLowerCase() } : null;
}

const QUERY = `query getProducts($country: String!, $first: Int!, $languageSelector: [String!] = ["en"], $where: [ProductFilterInput!] = [], $with: ProductOptionInput!) {
  products: connectedProducts(first: $first, where: $where, with: $with) { edges { node {
    id images gender name: nameByLanguage(lang: $languageSelector)
    brand: newBrand { name(lang: $languageSelector) }
    category: newCategory { name(lang: $languageSelector) }
    variants { stock }
    price: priceByCountry(country: [$country]) { currency regularPrice lowestPrice(discountNames: []) }
  } } } }`;

const en = (v: any): string => String((v && typeof v === "object" ? v.en : v) ?? "").trim();

/** Map a GraphQL body. Pure. */
export function mapSsenseProduct(body: any, id: string, url: string, market = "CA"): LiveProduct | null {
  const n = (body?.data?.products?.edges ?? []).map((e: any) => e?.node).find((x: any) => String(x?.id) === id);
  const title = en(n?.name);
  if (!n || !title) return null;
  const pr = (Array.isArray(n.price) ? n.price : []).find((p: any) => p?.currency === SSENSE_CURRENCY[market]);
  const regular = Math.round(Number(pr?.regularPrice) * 100);
  const low = Math.round(Number(pr?.lowestPrice?.amount) * 100);
  const price = low > 0 ? low : regular;
  if (!(price > 0)) return null;
  const make = en(n.brand?.name);
  const img = Array.isArray(n.images) && typeof n.images[0] === "string" ? n.images[0].replace("__IMAGE_PARAMS__", IMG) : null;
  const variants: any[] = Array.isArray(n.variants) ? n.variants : [];
  return {
    brand: "ssense",
    externalId: id,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url,
    imageUrl: img,
    price,
    listPrice: regular > price ? regular : null,
    inStock: variants.length ? variants.some((v) => Number(v?.stock) > 0) : true,
    category: en(n.category?.name).toLowerCase() || null,
    type: null,
    gender: n.gender === "women" ? "kadin" : n.gender === "men" ? "erkek" : null,
    colorName: null,
    country: market as LiveProduct["country"],
    currency: SSENSE_CURRENCY[market],
  };
}

export async function ssenseUrl(url: string): Promise<LiveProduct | null> {
  const hit = ssenseIdFromUrl(url);
  if (!hit) return null;
  const clean = (() => { const u = new URL(url); u.search = ""; u.hash = ""; return u.toString(); })();
  const market = ssenseCountryFromUrl(url);
  const country = countryFor("ssense", market);
  let body: any = null;
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, "x-client-version": "4.6.1" },
      body: JSON.stringify({ query: QUERY, variables: { country: market, first: 1, where: [{ id: { equals: hit.id } }], with: { country: market, lang: "en" } } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: constellation.ssense.com refused with HTTP ${r.status}${usingProxy() ? ` (via ${country} proxy)` : " (direct egress)"}`);
      return null;
    }
    body = await r.json();
  } catch (err) {
    console.warn(`live-lookup: constellation.ssense.com unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return body ? mapSsenseProduct(body, hit.id, clean, market) : null;
}
