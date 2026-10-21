/**
 * THE ICONIC (theiconic.com.au) — Australia's largest fashion e-tailer,
 * multi-brand. Women's sale only, read through `eve.theiconic.com.au`, the
 * catalogue API the Android app calls (`catalog/products`).
 *
 * The website and eve both sit behind Cloudflare, which challenges browser
 * User-Agents. eve lets through the app's own headers — `THE_ICONIC/<sdk>/<ver>`
 * plus `client-id` / `client-os-version` (read from the app's OkHttp
 * interceptor, com.theiconic.android 2.150.1). Verified from a GitHub runner,
 * probe run 38134856152, no proxy.
 *
 * `gender=female&sale=1` is the women's sale (~34k products, all reduced);
 * 200 per page is the largest page the API accepts (500 → HTTP 500), so the cap
 * is 8 requests. The listing carries price/final_price, brand and photos but no
 * sizes (those are per-product calls), so sizes are not collected. The listing
 * only shows purchasable products, so every row is in stock.
 *
 * Photos (static.theiconic.com.au): curl / node / python / JDK get a Cloudflare
 * 403 (TLS fingerprint), but iOS NSURLSession, Chrome and check-host.net from 8
 * countries get 200 with no Referer (2026-10-22) — test with a real client.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "theiconic";

const API = "https://eve.theiconic.com.au/catalog/products";
const SITE = "https://www.theiconic.com.au";
const APP_VERSION = "2.150.1";
export const APP_HEADERS: Record<string, string> = {
  "User-Agent": `THE_ICONIC/34/${APP_VERSION}`,
  "client-id": `Android_${APP_VERSION}`,
  "client-os-version": "Android_v34",
  Accept: "application/json",
};
const PAGE_SIZE = 200;
const CAP = 1500;
const MAX_PAGES = Math.ceil(CAP / PAGE_SIZE) + 1;
const PAUSE_MS = 800;

export function pageUrl(page: number): string {
  return `${API}?page_size=${PAGE_SIZE}&page=${page}&gender=female&sale=1`;
}

/** Map one listing product. Pure; null unless it is genuinely reduced. */
export function mapIconic(p: any, country: CountryCode = "AU"): ProductRecord | null {
  if (!p?.sku || !p?.name || !p?.link || p.is_gift_card) return null;
  const price = Number(p.final_price);
  const was = Number(p.price);
  if (!(Number.isFinite(price) && price > 0 && Number.isFinite(was) && price < was)) return null;
  const label = String(p?._embedded?.brand?.name ?? "").trim();
  const title = String(p.name).trim();
  const name = label && !title.toLowerCase().startsWith(label.toLowerCase()) ? `${label} ${title}` : title;
  const imgs: string[] = (p?._embedded?.images ?? [])
    .map((i: any) => i?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const siblings: string[] = (p?.variants?.items ?? []).map((v: any) => String(v?.sku ?? "")).filter(Boolean);
  return {
    brand,
    country,
    externalId: String(p.sku),
    name,
    url: `${SITE}/${String(p.link).replace(/^\//, "")}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: null,
    gender: "kadin",
    variants: null,
    // The colour siblings the API itself lists for this style.
    groupKey: siblings.length > 1 ? [...siblings].sort()[0] : null,
  };
}

/**
 * Stop paging once the API says we are past its last page, or a page comes back
 * empty. A short page is NOT the end: eve drops a row now and then (page 3 of
 * the women's sale came back with 199 of 200 on 2026-10-12 while page_count was
 * 167), and stopping on it capped two runs at 599 products instead of 1500.
 * Only when page_count is missing does a short page mean the end.
 */
export function isLastPage(rows: number, page: number, pageCount: unknown): boolean {
  if (rows === 0) return true;
  const total = Number(pageCount);
  if (Number.isFinite(total) && total > 0) return page >= total;
  return rows < PAGE_SIZE;
}

export async function listTheIconic(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AU") return [];
  const byId = new Map<string, ProductRecord>();
  for (let n = 1; n <= MAX_PAGES && byId.size < CAP; n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const d = await getJson<any>(pageUrl(n), { headers: APP_HEADERS, country });
    const rows: any[] = d?._embedded?.product ?? [];
    for (const p of rows) {
      const r = mapIconic(p, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (isLastPage(rows.length, n, d?.page_count)) break;
  }
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listTheIconic;
