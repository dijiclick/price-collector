/**
 * Adore Beauty (adorebeauty.com.au) — Australia's largest online beauty
 * retailer, multi-brand. Products on sale in Australia, read from the site's
 * own Algolia index (app KE81A5WUZB, index `hasura_production_products`).
 *
 * Pages are behind PerimeterX, which challenges browser-like clients. Two
 * things make this work without a proxy (GitHub runner, probe run 38135133695):
 *   1. The site hands every visitor a short-lived SECURED Algolia key from
 *      `/api/algolia/generate_secure_key`, and that route answers a non-browser
 *      User-Agent (okhttp) directly.
 *   2. Algolia's own hosts are not behind the site's wall; the key is
 *      referer-restricted, so the request carries the site's Referer.
 *
 * `filters=is_on_sale_au:true` is the AU sale set (~460 products) — one query
 * of up to 1000 hits, so a run is 2 requests. Prices are AUD major units in
 * `prices[]` price books ("AUD List Price" / "AUD Sale Price"); products with
 * shade/size variations carry them per variation, and the cheapest reduced
 * variation is quoted. The index carries no per-variation stock, so no sizes.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "adorebeauty";

const SITE = "https://www.adorebeauty.com.au";
const KEY_URL = `${SITE}/api/algolia/generate_secure_key`;
const APP_ID = "KE81A5WUZB";
const INDEX = "hasura_production_products";
const UA = "okhttp/4.12.0";
const CAP = 1500;

const ATTRS = [
  "objectID", "sku", "name", "prices", "variations", "has_available_inventory", "metadata",
  "images", "brand_facet", "hierarchical_categories", "barcode", "is_on_sale_au",
];

export function queryBody(page: number): string {
  const p = new URLSearchParams({
    hitsPerPage: "1000",
    page: String(page),
    filters: "is_on_sale_au:true",
    attributesToRetrieve: JSON.stringify(ATTRS),
    attributesToHighlight: "[]",
    attributesToSnippet: "[]",
  });
  return JSON.stringify({ params: p.toString() });
}

/** AUD list/sale out of a `prices` array of price books. */
export function audPrices(prices: unknown): { list: number | null; sale: number | null } {
  const rows: any[] = Array.isArray(prices) ? prices : [];
  const get = (book: string) => {
    const n = Number(rows.find((r) => r?.price_book_name === book)?.amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { list: get("AUD List Price"), sale: get("AUD Sale Price") };
}

const imageUrl = (rel: unknown): string | null =>
  typeof rel !== "string" || !rel ? null : /^https?:\/\//.test(rel) ? rel : `${SITE}${rel.startsWith("/") ? "" : "/"}${rel}`;

/** Map one Algolia hit. Pure; null unless genuinely reduced in AUD. */
export function mapAdore(h: any, country: CountryCode = "AU"): ProductRecord | null {
  if (!h?.objectID || !h?.name || !h?.metadata?.url_path) return null;
  const vars: any[] = Array.isArray(h.variations) ? h.variations : [];
  const offers = (vars.length ? vars.map((v) => audPrices(v?.prices)) : [audPrices(h.prices)])
    .filter((o): o is { list: number; sale: number } => o.list != null && o.sale != null && o.sale < o.list)
    .sort((a, b) => a.sale - b.sale);
  const best = offers[0];
  if (!best) return null;

  const imgs = ((h.images ?? []) as any[])
    .slice()
    .sort((a, b) => Number(!!b?.is_primary) - Number(!!a?.is_primary) || Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0))
    .map((i) => imageUrl(i?.url_relative))
    .filter((u): u is string => !!u);
  const lvl0: string[] = Array.isArray(h?.hierarchical_categories?.lvl0) ? h.hierarchical_categories.lvl0 : [];
  const label = String(h?.brand_facet?.[0]?.name ?? "");
  const category = lvl0.find((c) => c !== label && !/specials|subscribe|gift|brand/i.test(c)) ?? null;
  const barcodes = [h.barcode, ...vars.map((v) => v?.barcode)]
    .map((b) => String(b ?? "").trim())
    .filter((b) => /^\d{8,14}$/.test(b));

  return {
    brand,
    country,
    externalId: String(h.objectID),
    name: String(h.name).trim(),
    url: `${SITE}${String(h.metadata.url_path).startsWith("/") ? "" : "/"}${h.metadata.url_path}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(best.sale),
    listPrice: toMinor(best.list),
    currency: COUNTRIES[country].currency,
    inStock: h.has_available_inventory !== false,
    barcodes: barcodes.length ? [...new Set(barcodes)] : null,
    category,
    gender: null,
    variants: null,
  };
}

export async function listAdoreBeauty(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AU") return [];
  const k = await getJson<any>(KEY_URL, { headers: { "User-Agent": UA }, country });
  const key = k?.data?.key;
  if (typeof key !== "string" || !key) throw new Error("adorebeauty: no secured Algolia key");
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < 3 && byId.size < CAP; page++) {
    const d = await getJson<any>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
      method: "POST",
      body: queryBody(page),
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": APP_ID,
        "X-Algolia-API-Key": key,
        Referer: `${SITE}/`,
      },
      country,
    });
    for (const h of d?.hits ?? []) {
      const r = mapAdore(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (page + 1 >= Number(d?.nbPages ?? 1)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listAdoreBeauty;
