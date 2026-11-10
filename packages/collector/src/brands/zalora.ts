/**
 * ZALORA (zalora.sg, zalora.com.hk) — South-East Asia's multi-brand fashion
 * store (Calvin Klein, Coach, Tommy Hilfiger, Mango, Nike, beauty …), for
 * Singapore (SGD) and Hong Kong (HKD).
 *
 * The site is a Next.js front on CloudFront; its catalogue API
 * `api.zalora.<tld>/v1/dynproducts/list` answers a plain GET with a browser
 * User-Agent and `Accept: application/json` (without the Accept header the
 * same route answers a binary Thrift body) — from a GitHub runner too (probe
 * 42799749679, both hosts 200). `specialKey=sale` is the site's sale listing
 * (58k of 129k women's styles in SG, 63k of 121k in HK on 2026-11-10), in the
 * site's own popularity order; `segment` is the department.
 *
 * A row needs `SpecialPriceInDecimal` below `PriceInDecimal`. Left out:
 * `HasDifferentSimplePrices` rows (the price differs by size, so the pair is a
 * range, not one markdown) and anything "reduced" by more than MAX_OFF — the
 * marketplace sellers' invented list prices (a S$232 gift set "was"
 * S$256,512). The list carries no per-size stock; it only lists buyable styles.
 *
 * 100 a page (the API's maximum), women first, ≤ 20 requests per market.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "zalora";

export const ZALORA_MARKETS: Partial<Record<CountryCode, { api: string; site: string; currency: string }>> = {
  SG: { api: "https://api.zalora.sg", site: "https://www.zalora.sg", currency: "SGD" },
  HK: { api: "https://api.zalora.com.hk", site: "https://www.zalora.com.hk", currency: "HKD" },
};

const PAGE = 100;
const CAP = 1500;
/** A deeper "discount" than this is a seller's invented list price. */
export const MAX_OFF = 0.85;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Walk {
  segment: "women" | "men";
  max: number;
}
export const WALKS: Walk[] = [
  { segment: "women", max: 1100 },
  { segment: "men", max: 400 },
];

export const listUrl = (api: string, w: Walk, offset: number): string =>
  `${api}/v1/dynproducts/list?segment=${w.segment}&specialKey=sale&limit=${PAGE}&offset=${offset}`;

const GENDER: Record<string, ProductRecord["gender"]> = { women: "kadin", men: "erkek", kids: "cocuk" };

/** Map one list product. Pure; null unless one real markdown in the market's currency. */
export function mapZalora(p: any, country: CountryCode, segment: Walk["segment"] = "women"): ProductRecord | null {
  const m = ZALORA_MARKETS[country];
  const id = String(p?.ConfigSku ?? "").trim();
  const title = String(p?.Name ?? "").trim();
  const path = String(p?.ProductUrl ?? "").replace(/^\/+/, "");
  if (!m || !id || !title || !path) return null;
  const list = Math.round(Number(p.PriceInDecimal) * 100);
  const price = Math.round(Number(p.SpecialPriceInDecimal) * 100);
  if (!(list > 0) || !(price > 0) || !(price < list)) return null;
  if (p.HasDifferentSimplePrices === true || p.IsNonSaleItem === true) return null;
  if (1 - price / list > MAX_OFF) return null;
  // The printed price names the currency ("S$ 39.00", "HK$ 650.00"): a host
  // answering another market's price list is no row.
  const printed = String(p.Price ?? "");
  if (printed && !printed.startsWith(country === "SG" ? "S$" : "HK$")) return null;

  const crumbs: string[] = Array.isArray(p.Breadcrumbs) ? p.Breadcrumbs.map(String).filter(Boolean) : [];
  const dept = (crumbs[0] ?? "").toLowerCase();
  const make = String(p.Brand ?? "").trim();
  const photos: string[] = (Array.isArray(p.ImageList) ? p.ImageList : [p.MainImageUrl]).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("https://"));
  const main = typeof p.MainImageUrl === "string" && p.MainImageUrl.startsWith("https://") ? p.MainImageUrl : photos[0] ?? null;
  return {
    brand,
    country,
    externalId: id,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url: `${m.site}/${path}`,
    imageUrl: main,
    images: cleanGallery(photos, main),
    price,
    listPrice: list,
    currency: m.currency,
    inStock: true,
    category: crumbs.length > 1 ? crumbs[crumbs.length - 1].toLowerCase() : null,
    maker: make || null,
    // Beauty and unisex rows carry no department: unknown, not the walk's.
    gender: dept in GENDER ? GENDER[dept] : dept === "beauty" || !dept ? null : GENDER[segment],
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

export async function listZalora(country: CountryCode): Promise<ProductRecord[]> {
  const m = ZALORA_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  const problems: string[] = [];
  let seen = 0;
  let requests = 0;
  for (const w of WALKS) {
    let taken = 0;
    // A page keeps ~half its rows (size-ranged prices are dropped), so the
    // offset runs past `max`; the request budget is what stops the walk.
    for (let offset = 0; taken < w.max && byId.size < CAP && requests < (w.segment === "women" ? 14 : 20); offset += PAGE) {
      if (requests > 0) await sleep(600);
      requests++;
      const data = await getJson<any>(listUrl(m.api, w, offset), { country, headers: { Accept: "application/json", "Accept-Language": "en" }, retries: 1, timeoutMs: 30_000 }).catch((e) => {
        problems.push(`${w.segment}@${offset}: ${String(e).slice(0, 100)}`);
        return null;
      });
      const rows: any[] = data?.data?.Products ?? [];
      seen += rows.length;
      for (const p of rows) {
        const r = mapZalora(p, country, w.segment);
        if (r && !byId.has(r.externalId) && taken < w.max) {
          byId.set(r.externalId, r);
          taken++;
        }
      }
      // A full page can come back one short (99 of 100 seen mid-listing): only an empty page ends the walk.
      if (rows.length === 0) break;
    }
  }
  if (seen === 0) throw new Error(`zalora/${country}: every sale page returned no products (${problems.slice(0, 3).join("; ")})`);
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listZalora;
