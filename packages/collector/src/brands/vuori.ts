/**
 * Vuori (US, CA) — headless Next.js front on Shopify, so `/products.json` is
 * switched off (404). The Storefront API is the route: the site's own public
 * Storefront token (shipped in its JS bundle, the same one every shopper's
 * browser sends) on `vuori-clothing.myshopify.com/api/<v>/graphql.json`.
 * `@inContext(country:)` returns that market's prices and stock in its own
 * currency (US → USD, CA → CAD), so one shop serves both markets.
 *
 * Read: the "sale-1" collection (Men's & Women's Sale), `available: true`
 * filter — 2,482 US / 339 CA in-stock reduced styles on 2026-10-21, every one
 * with compareAtPrice > price. Each product is one colourway ("Echo Insulated
 * Vest 2.0 | Thyme"); the `family::` tag groups the colours of one style.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { genderOf } from "./_shopify";

const API = "https://vuori-clothing.myshopify.com/api/2025-01/graphql.json";
/** Public Storefront token from vuoriclothing.com's bundle (not a secret). */
const TOKEN = "d0518f77a8ba03c47d5a5818a1d7c8d4";
const COLLECTION = "sale-1";
const SITES: Partial<Record<CountryCode, string>> = {
  US: "https://vuoriclothing.com",
  CA: "https://vuoriclothing.ca",
};
const CAP = 1500;
const MAX_PAGES = 12;
const PAUSE_MS = 800;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const vuoriQuery = (country: CountryCode, after: string | null) => `query @inContext(country: ${country}) {
  collection(handle: "${COLLECTION}") {
    products(first: 250, filters: [{ available: true }]${after ? `, after: ${JSON.stringify(after)}` : ""}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title productType tags availableForSale
        images(first: 6) { nodes { url } }
        variants(first: 60) { nodes { availableForSale price { amount currencyCode } compareAtPrice { amount } selectedOptions { name value } } }
      }
    }
  }
}`;

/** Map one Storefront API product node. Pure. */
export function mapVuori(country: CountryCode, p: any): ProductRecord | null {
  const site = SITES[country];
  const vs: any[] = p?.variants?.nodes ?? [];
  if (!site || !p?.id || !p?.title || !p?.handle || !vs.length) return null;
  const priced = vs
    .map((v) => ({ v, price: parseFloat(v?.price?.amount), cmp: parseFloat(v?.compareAtPrice?.amount) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  const pick = [...priced].sort((a, b) => Number(b.v.availableForSale) - Number(a.v.availableForSale) || a.price - b.price)[0];
  const currency = String(pick.v.price?.currencyCode ?? "");
  if (currency !== COUNTRIES[country].currency) return null;
  const tags: string[] = Array.isArray(p.tags) ? p.tags.map(String) : [];
  const tagVal = (k: string) => tags.find((t) => t.toLowerCase().startsWith(`${k}::`))?.slice(k.length + 2) ?? null;
  const g = (tagVal("gender") ?? "").toLowerCase();
  const gender: ProductRecord["gender"] = /kid|boy|girl|youth/.test(g) ? "cocuk" : /women/.test(g) ? "kadin" : /\bmen/.test(g) ? "erkek" : genderOf({ tags, title: p.title, product_type: p.productType }, null);
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of vs) {
    const label = String((v?.selectedOptions ?? []).find((o: any) => /size/i.test(String(o?.name)))?.value ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: v.availableForSale ? "in_stock" : "out_of_stock" });
  }
  const colour = String(p.title).includes(" | ") ? String(p.title).split(" | ").pop()!.trim() : null;
  const imgs: string[] = (p.images?.nodes ?? []).map((im: any) => im?.url).filter((u: unknown) => typeof u === "string");
  const family = tagVal("family");
  return {
    brand: "vuori",
    country,
    externalId: String(p.id).split("/").pop()!,
    name: String(p.title).trim(),
    url: `${site}/products/${p.handle}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? toMinor(pick.cmp) : null,
    currency,
    inStock: vs.some((v) => v?.availableForSale === true),
    category: typeof p.productType === "string" && p.productType ? p.productType : null,
    gender,
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: family ? `vuori:${family}` : null,
    colorName: colour,
  };
}

export async function listVuori(country: CountryCode): Promise<ProductRecord[]> {
  if (!SITES[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let after: string | null = null;
  for (let n = 1; ; n++) {
    if (n > MAX_PAGES) throw new Error(`vuori/${country}: more than ${MAX_PAGES} pages before the ${CAP} cap`);
    if (n > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(API, {
      method: "POST",
      country,
      retries: 2,
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": TOKEN },
      body: JSON.stringify({ query: vuoriQuery(country, after) }),
    });
    const conn = data?.data?.collection?.products;
    if (!conn || !Array.isArray(conn.nodes)) throw new Error(`vuori/${country}: page ${n} unreadable ${JSON.stringify(data?.errors ?? data).slice(0, 200)}`);
    for (const p of conn.nodes) {
      const r = mapVuori(country, p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (byId.size >= CAP || !conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  if (byId.size === 0) throw new Error(`vuori/${country}: sale collection returned no reduced rows`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
