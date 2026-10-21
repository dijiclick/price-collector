/**
 * NEW YORKER Germany, through the NEW YORKER app's product API (2026-10-21).
 *
 * newyorker.de's catalogue is a client-side app over the same public API the
 * Android app (`de.pilot.newyorker.android`) uses:
 * `api.newyorker.de/csp/products/public/query` — no key, no cookie, and it
 * answers a GitHub runner 200 (probe run 39613942935).
 *
 * `filters[sale]=true` returns the items with at least one colour on sale
 * (~780 for DE, 100 a page → ~8 requests). An item is a style group; each of
 * its `variants` is one colour of one article (`product_id` + `id`) with its
 * own `original_price` / `current_price` in euros and a `sale` flag. Only
 * variants that are flagged AND priced below their original are kept.
 *
 * NEW YORKER sells in its stores, not through a German web shop, and the API
 * carries no stock: a published variant is listed as in stock, and no per-size
 * availability is invented (variants: null). Sizes exist in the feed but
 * without stock they would make restock alerts lie.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://api.newyorker.de/csp/products/public/query";
const IMG = "https://api.newyorker.de/csp/images/image/public";
const SITE = "https://www.newyorker.de";
const PAGE = 100;
const MAX_PAGES = 20;
const CAP = 1500;
/** Markets whose feed we read: the API takes the country as a filter. */
const MARKETS: Partial<Record<CountryCode, string>> = { DE: "de" };

/**
 * Other markets (2026-10-21): the same API with `filters[country]=<cc>`. Each
 * answers in its own currency (CHF, SEK, DKK, NOK, else EUR). Names: German
 * for AT/CH, French for FR, English elsewhere (what newyorker.de/<cc>/ shows;
 * the feed has no Dutch/Spanish/Italian/Portuguese/Nordic text). The site's
 * product page lives under /<cc>/products/.
 */
export const NY_MARKETS: Partial<Record<CountryCode, { code: string; lang: string; currency: string }>> = {
  AT: { code: "at", lang: "DE", currency: "EUR" },
  CH: { code: "ch", lang: "DE", currency: "CHF" },
  FR: { code: "fr", lang: "FR", currency: "EUR" },
  NL: { code: "nl", lang: "EN", currency: "EUR" },
  BE: { code: "be", lang: "EN", currency: "EUR" },
  ES: { code: "es", lang: "EN", currency: "EUR" },
  IT: { code: "it", lang: "EN", currency: "EUR" },
  PT: { code: "pt", lang: "EN", currency: "EUR" },
  SE: { code: "se", lang: "EN", currency: "SEK" },
  DK: { code: "dk", lang: "EN", currency: "DKK" },
  FI: { code: "fi", lang: "EN", currency: "EUR" },
  NO: { code: "no", lang: "EN", currency: "NOK" },
};

export const queryUrl = (market: string, offset: number): string =>
  `${API}?offset=${offset}&limit=${PAGE}&filters%5Bcountry%5D=${market}&filters%5Bsale%5D=true`;

const GENDER: Record<string, ProductRecord["gender"]> = { FEMALE: "kadin", MALE: "erkek" };

const imageUrl = (key: string) => `${IMG}/${key}?res=high&frame=2_3`;

/** Map one item to its reduced colours. Pure. */
export function mapNewYorker(item: any, country: CountryCode): ProductRecord[] {
  const intl = NY_MARKETS[country];
  const descs: any[] = Array.isArray(item?.descriptions) ? item.descriptions : [];
  const desc = intl
    ? (descs.find((d: any) => d?.language === intl.lang && String(d?.description ?? "").trim()) ?? descs.find((d: any) => d?.language === "EN" && String(d?.description ?? "").trim()))?.description
    : descs.find((d: any) => d?.language === "DE")?.description;
  const currency = intl?.currency ?? "EUR";
  const site = intl ? `${SITE}/${intl.code}` : SITE;
  const name = String(desc ?? "").trim();
  if (!name) return [];
  const variants: any[] = Array.isArray(item?.variants) ? item.variants : [];
  const out: ProductRecord[] = [];
  for (const v of variants) {
    const pid = String(v?.product_id ?? "").trim();
    const vid = String(v?.id ?? "").trim();
    const price = Number(v?.current_price);
    const was = Number(v?.original_price);
    if (!pid || !vid || v?.sale !== true || !(price > 0) || !(was > price)) continue;
    if (v?.currency && v.currency !== currency) continue;
    const imgs = (Array.isArray(v.images) ? v.images : [])
      .filter((im: any) => typeof im?.key === "string" && im.key)
      .sort((a: any, b: any) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((im: any) => imageUrl(im.key));
    const color = String(v.color_group ?? v.pantone_color_name ?? "").trim() || null;
    out.push({
      brand: "newyorker",
      country,
      externalId: `${pid}-${vid}`,
      name,
      url: `${site}/products/#/detail/${pid}/${vid}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(price),
      listPrice: toMinor(was),
      currency,
      inStock: true,
      // NEW YORKER's in-house brands (Amisu, Censored, FB Sister, Smog, ...).
      maker: typeof item.brand === "string" && item.brand.trim() && item.brand !== "Accessoires" ? item.brand.trim() : null,
      category: typeof item.maintenance_group === "string" ? item.maintenance_group : null,
      gender: GENDER[String(item.customer_group)] ?? null,
      variants: null,
      groupKey: variants.length > 1 && item.product_key ? `newyorker:${item.product_key}` : null,
      colorName: color,
    });
  }
  return out;
}

export async function listNewYorker(country: CountryCode, fetchPage: (u: string) => Promise<any> = (u) => getJson(u, { country, headers: { "User-Agent": "okhttp/4.12.0" }, retries: 2 })): Promise<ProductRecord[]> {
  const market = MARKETS[country] ?? NY_MARKETS[country]?.code;
  if (!market) return [];
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && page * PAGE < total; page++) {
    const d = await fetchPage(queryUrl(market, page * PAGE));
    total = Number(d?.totalCount ?? 0);
    const items: any[] = Array.isArray(d?.items) ? d.items : [];
    if (!items.length) break;
    for (const it of items) for (const r of mapNewYorker(it, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  const out = [...byId.values()].slice(0, CAP);
  console.log(`newyorker/${country}: ${out.length} reduced colours of ${total} sale items`);
  return out;
}
