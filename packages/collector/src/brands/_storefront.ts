/**
 * Shopify stores whose `/products.json` is closed (headless Hydrogen/Remix
 * fronts, or a feed that 404s) but whose Storefront GraphQL API answers — with
 * the public token the shop ships in its own page HTML, or tokenless (Shopify
 * serves product/collection reads without a token). Measured 2026-10-11.
 *
 * `@inContext(country:)` makes the API price in that market's currency, so one
 * Shopify store with Markets (Skims US/CA/GB, Aldo US/CA) serves every market
 * from one host. Each row is reshaped into the `/products.json` shape and goes
 * through `mapShopify`, so gender, sizes, colour and the gift-card filter are
 * exactly the generic adapter's.
 *
 * Only reduced rows are kept, in-stock first, capped. With a `collection` the
 * walk is two passes over that collection — `available: true` first, then
 * sold-out (restock candidates) until the cap — so the in-stock rows can never
 * be crowded out by a long sold-out tail.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { mapShopify } from "./_shopify";

export interface StorefrontStore {
  brand: string;
  /** Storefront API host: the shop's own domain or its myshopify domain. */
  host: string;
  /** Public Storefront token from the shop's page; absent = tokenless request. */
  token?: string;
  /** Product-page origin per market, path prefix included (`https://skims.com/en-ca`). */
  sites: Partial<Record<CountryCode, string>>;
  /** Sale collection handle. Absent = the whole catalogue (shops with no sale collection). */
  collection?: string;
  defaultGender?: "kadin" | "erkek" | "cocuk" | null;
  /** Shop-specific tag dialect, consulted when the generic tag reading finds no gender. */
  tagGender?: (tags: string[]) => ProductRecord["gender"];
  maxProducts?: number;
}

const API_VERSION = "2025-01";
const PAGE = 250;
const MAX_PAGES = Number(process.env.STOREFRONT_MAX_PAGES ?? 24);
const PAUSE_MS = Number(process.env.STOREFRONT_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NODE = `id handle title productType tags
  images(first: 6) { nodes { url } }
  options { name }
  variants(first: 100) { nodes { availableForSale price { amount currencyCode } compareAtPrice { amount } selectedOptions { name value } } }`;

const COLLECTION_QUERY = `query($h: String!, $c: CountryCode, $a: String, $f: [ProductFilter!]) @inContext(country: $c) {
  collection(handle: $h) { products(first: ${PAGE}, after: $a, filters: $f) { pageInfo { hasNextPage endCursor } nodes { ${NODE} } } } }`;

const CATALOGUE_QUERY = `query($c: CountryCode, $a: String) @inContext(country: $c) {
  products(first: ${PAGE}, after: $a) { pageInfo { hasNextPage endCursor } nodes { ${NODE} } } }`;

/** The numeric id from `gid://shopify/Product/123` — the same id `/products.json` uses. */
const numericId = (gid: unknown): string => String(gid ?? "").split("/").pop() ?? "";

/**
 * One Storefront product node → the `/products.json` shape `mapShopify` reads.
 * Returns null when the API priced it in a currency other than `currency`
 * (a market the shop does not sell to falls back to its base currency).
 */
export function toProductsJson(node: any, currency: string): any | null {
  const vs: any[] = node?.variants?.nodes ?? [];
  if (!node?.id || !vs.length) return null;
  if (vs.some((v) => v?.price?.currencyCode && v.price.currencyCode !== currency)) return null;
  const optionNames: string[] = (node.options ?? []).map((o: any) => String(o?.name ?? ""));
  return {
    id: numericId(node.id),
    title: node.title,
    handle: node.handle,
    product_type: node.productType ?? "",
    tags: node.tags ?? [],
    options: optionNames.map((name) => ({ name })),
    images: (node.images?.nodes ?? []).map((im: any) => ({ src: im?.url })),
    variants: vs.map((v) => {
      const row: any = {
        available: v?.availableForSale === true,
        price: v?.price?.amount ?? null,
        compare_at_price: v?.compareAtPrice?.amount ?? null,
      };
      for (const so of v?.selectedOptions ?? []) {
        const i = optionNames.indexOf(String(so?.name ?? ""));
        if (i >= 0) row[`option${i + 1}`] = so.value;
      }
      return row;
    }),
  };
}

async function post(store: StorefrontStore, query: string, variables: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (store.token) headers["X-Shopify-Storefront-Access-Token"] = store.token;
  const data = await getJson<any>(`https://${store.host}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    retries: 2,
  });
  if (data?.errors?.length) throw new Error(`${store.brand}: ${String(data.errors[0]?.message ?? "graphql error")}`);
  return data?.data;
}

export async function listStorefront(store: StorefrontStore, country: CountryCode): Promise<ProductRecord[]> {
  const site = store.sites[country];
  if (!site) return [];
  const cap = store.maxProducts ?? 1500;
  const currency = COUNTRIES[country].currency;
  const byId = new Map<string, ProductRecord>();
  const passes: (boolean | null)[] = store.collection ? [true, false] : [null];
  let requests = 0;
  for (const available of passes) {
    let after: string | null = null;
    for (let n = 0; n < MAX_PAGES && byId.size < cap; n++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const data: any = store.collection
        ? await post(store, COLLECTION_QUERY, { h: store.collection, c: country, a: after, f: [{ available }] })
        : await post(store, CATALOGUE_QUERY, { c: country, a: after });
      const conn: any = store.collection ? data?.collection?.products : data?.products;
      if (!conn) {
        if (requests === 1) throw new Error(`${store.brand}/${country}: collection "${store.collection}" not found`);
        break;
      }
      for (const node of conn.nodes ?? []) {
        const p = toProductsJson(node, currency);
        const r = p && mapShopify(store, country, site, p);
        if (r && r.gender == null && store.tagGender) r.gender = store.tagGender(p.tags);
        if (r && r.listPrice != null && byId.size < cap) byId.set(r.externalId, r);
      }
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
