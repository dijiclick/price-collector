/**
 * Pasted links for the luxury Shopify-Markets stores in ./lux-sites.ts
 * (THE OUTNET, Browns, END., Julian Fashion, Antonioli,
 * TheDoubleF, Slam Jam, The Webster). The
 * tokenless Storefront API answers one product by handle; `@inContext` prices
 * it for the market in the link's `/en-<cc>/` prefix (else the shop's home
 * market). Same source as the collector (brands/_luxstorefront.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { COUNTRIES, type CountryCode } from "../countries";
import { UA } from "../live-http";
import { LUX_SITES, luxTarget, type LuxSite } from "./lux-sites";

const QUERY = `query LuxProduct($h: String!, $cc: CountryCode!) @inContext(country: $cc) {
  product(handle: $h) {
    id title vendor productType availableForSale tags
    options { name }
    images(first: 1) { nodes { url } }
    variants(first: 40) { nodes { availableForSale selectedOptions { name value } price { amount currencyCode } compareAtPrice { amount } } }
  }
}`;

/** Map a Storefront `product(handle:)` body. Pure. */
export function mapLuxProduct(site: LuxSite, country: CountryCode, body: any, url: string): LiveProduct | null {
  const p = body?.data?.product;
  const title = String(p?.title ?? "").trim();
  const vs: any[] = p?.variants?.nodes ?? [];
  if (!p?.id || !title || !vs.length) return null;
  const currency = COUNTRIES[country].currency;
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v?.price?.amount), cmp: parseFloat(v?.compareAtPrice?.amount) }))
    .filter((x) => String(x.v?.price?.currencyCode) === currency && Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  const pick = [...priced].sort((a, b) => Number(!!b.v.availableForSale) - Number(!!a.v.availableForSale) || a.price - b.price)[0];
  const tags: string[] = Array.isArray(p.tags) ? p.tags.map(String) : [];
  const type = String(p.productType ?? "").trim();
  const vendor = String(p.vendor ?? "").trim();
  const colourName = (p.options ?? []).map((o: any) => String(o?.name ?? "")).find((n: string) => /colou?r/i.test(n));
  const colours = colourName
    ? [...new Set(vs.map((v) => String((v?.selectedOptions ?? []).find((o: any) => o?.name === colourName)?.value ?? "").trim()).filter(Boolean))]
    : [];
  return {
    brand: site.brand,
    externalId: String(p.id).split("/").pop()!,
    name: vendor && !title.toLowerCase().startsWith(vendor.toLowerCase()) ? `${vendor} ${title}` : title,
    url,
    imageUrl: p.images?.nodes?.[0]?.url ?? null,
    price: Math.round(pick.price * 100),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? Math.round(pick.cmp * 100) : null,
    inStock: vs.some((v) => v?.availableForSale === true),
    category: (site.category ? site.category(type, tags) : type) || null,
    type: null,
    gender: site.tagGender ? site.tagGender(tags, null) : null,
    colorName: colours.length === 1 ? colours[0] : null,
    country,
    currency,
  };
}

export async function luxUrl(url: string): Promise<LiveProduct | null> {
  const hit = luxTarget(url);
  if (!hit) return null;
  const clean = (() => { const u = new URL(url); u.search = ""; u.hash = ""; return u.toString(); })();
  try {
    const r = await fetch(`https://${hit.site.host}/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify({ query: QUERY, variables: { h: hit.handle, cc: hit.country } }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${hit.site.host} storefront refused with HTTP ${r.status}`);
      return null;
    }
    return mapLuxProduct(hit.site, hit.country, await r.json(), clean);
  } catch (err) {
    console.warn(`live-lookup: ${hit.site.host} storefront unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export const LUX_RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = Object.fromEntries(
  LUX_SITES.map((s) => [s.brand, luxUrl]),
);
