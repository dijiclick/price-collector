/**
 * One Shopify COLLECTION (usually "sale") read through `/collections/<handle>/
 * products.json` on the shop's `*.myshopify.com` host. For stores whose own
 * domain is walled (Cloudflare challenge, Vercel bot rule) while Shopify's edge
 * still answers datacenter IPs — the host is in each shop's `/meta.json`
 * (`myshopify_domain`), and its `currency` is checked against the market.
 *
 * Rows are mapped with `_shopify.ts`'s `mapShopify` (same contract: reduced
 * only, in-stock first, capped). A sale collection can be thousands of
 * products deep, so paging stops as soon as the cap is filled with in-stock
 * rows.
 *
 * `Accept-Language` is sent EMPTY on purpose. With any language present
 * Shopify geolocates the caller and applies that country's market: from a
 * Turkish line MESHKI US marked every variant `available: false` (it does not
 * sell to TR), and a US runner reading an AU shop would get the US market.
 * Without it the shop answers in its own default market — measured 2026-10-11.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";
import { mapShopify } from "./_shopify";

export interface CollectionShop {
  brand: string;
  /** `https://<shop>.myshopify.com` — where products.json is read. */
  apiOrigin: string;
  /** Public storefront origin used in product URLs. */
  site: string;
  collection: string;
  defaultGender?: ProductRecord["gender"];
  /**
   * Every row's gender, overriding the tag/title heuristic — for women-only
   * labels whose titles trip it ("Iconic Girl Halter Dress" is not kidswear).
   */
  gender?: ProductRecord["gender"];
  maxProducts?: number;
}

const MAX_PAGES = Number(process.env.SHOPIFY_COLLECTION_MAX_PAGES ?? 30);
const PAUSE_MS = Number(process.env.SHOPIFY_PAUSE_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function collectionPageUrl(shop: CollectionShop, page: number): string {
  return `${shop.apiOrigin}/collections/${shop.collection}/products.json?limit=250&page=${page}`;
}

/** Map one products.json row: reduced rows only, `gender` override applied. Pure. */
export function mapCollectionRow(shop: CollectionShop, country: CountryCode, p: any): ProductRecord | null {
  const store = { brand: shop.brand, sites: { [country]: shop.site }, defaultGender: shop.defaultGender ?? null };
  const m = mapShopify(store, country, shop.site, p);
  if (!m || m.listPrice == null) return null;
  return shop.gender !== undefined ? { ...m, gender: shop.gender } : m;
}

export async function listShopifyCollection(shop: CollectionShop, country: CountryCode): Promise<ProductRecord[]> {
  const cap = shop.maxProducts ?? 1500;
  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  for (let n = 1; n <= MAX_PAGES && inStock < cap; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(collectionPageUrl(shop, n), {
      country,
      retries: 2,
      headers: { "Accept-Language": "", cookie: `localization=${country}` },
    });
    const rows: any[] = Array.isArray(d?.products) ? d.products : [];
    if (!rows.length) break;
    for (const p of rows) {
      const r = mapCollectionRow(shop, country, p);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      if (r.inStock) inStock++;
    }
    if (rows.length < 250) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
