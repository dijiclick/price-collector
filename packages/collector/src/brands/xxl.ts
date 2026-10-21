/**
 * XXL Norway — WOMEN'S sale only — through the Voyado Elevate storefront API
 * the site's own Next.js client calls (cluster `wae24fd27`, found as
 * `elevateClusterApi.baseURL` in the home page's config, 2026-10-11).
 *
 * No key, no cookie, no proxy: the cluster answers a plain POST with random
 * customer/session keys. XXL keeps its catalogue rules client-side, so the
 * request carries them the way the site does — a `productRules` string in the
 * body:
 *   - `custom.pim_mandatory_user_string {"Dame"}` = the "Bruker: Dame" facet
 *     (2,6k women's products, measured),
 *   - plus XXL's own ECOM visibility rules (copied from the bundle, minus the
 *     in-stock rule so a sold-out sale item can still light up a restock).
 * `sort=DISCOUNT` puts the reduced rows first, so paging stops at the first
 * page without a reduction. One page (100 groups) carries every colour with
 * its sizes, per-size stock and per-size price — no detail calls.
 */
import { randomUUID } from "node:crypto";
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const API = "https://wae24fd27.elevate-api.cloud/api/storefront/v3/queries/landing-page";
const SITE = "https://www.xxl.no";
const PAGE = 100;
const MAX_PAGES = Number(process.env.XXL_MAX_PAGES ?? 25);
const CAP = 1500;
const PAUSE_MS = Number(process.env.XXL_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VISIBILITY =
  'incl custom.isSoldIndividually {"true"} incl custom.hasPrimaryImage {"true"} ' +
  'incl custom.productType {"NORMAL" "BUNDLE" "BUNDLE_MULTIPACK" "PRODUCT_MULTIPACK"} ' +
  'incl custom.isSuitableForOnlineCatalog {"true"} excl custom.productStatusCode {"SER" "STOREMATR"} ' +
  'excl custom.isPossibleBundleSettings {"true"} excl custom.salesMethodCode {"1" "2" "13"} ' +
  'excl custom.onlyAvailableInStoreNoClickAndCollectLowPrice {"true"} excl custom.isPriceValid {"false"} ' +
  'excl custom.isReleased {"false"} excl price [-infinity, 0.0]';
export const XXL_WOMEN_RULE = `rule incl custom.pim_mandatory_user_string {"Dame"} ${VISIBILITY}`;

interface XxlMarket { market: string; locale: string; site: string; rule: string; pageReference: string }

/**
 * 2026-10-21: xxl.se and xxl.fi run on the same Elevate cluster (their home
 * pages carry the same `elevateClusterApi.baseURL`); only `market`/`locale`
 * and the localized "user" facet value change ("Dam" 1,564 / "Naiset" 1,565
 * women's products, measured). FI prices in EUR, SE in SEK.
 */
export const XXL_MARKETS: Partial<Record<CountryCode, XxlMarket>> = {
  NO: { market: "NO", locale: "nb-NO", site: SITE, rule: XXL_WOMEN_RULE, pageReference: "/dame/salg" },
  SE: { market: "SE", locale: "sv-SE", site: "https://www.xxl.se", rule: XXL_WOMEN_RULE.replace('{"Dame"}', '{"Dam"}'), pageReference: "/dam/rea" },
  FI: { market: "FI", locale: "fi-FI", site: "https://www.xxl.fi", rule: XXL_WOMEN_RULE.replace('{"Dame"}', '{"Naiset"}'), pageReference: "/naiset/ale" },
};

export function xxlUrl(skip: number, keys: { customer: string; session: string }, m: XxlMarket = XXL_MARKETS.NO!): string {
  const q = new URLSearchParams({
    market: m.market,
    locale: m.locale,
    customerKey: keys.customer,
    sessionKey: keys.session,
    touchpoint: "desktop",
    pageReference: m.pageReference,
    channels: "ONLINE",
    sort: "DISCOUNT",
    limit: String(PAGE),
    skip: String(skip),
  });
  return `${API}?${q}`;
}

const n = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

function sizesOf(variants: any[]): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const label = String(v?.label ?? v?.size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const stock = n(v?.stockNumber);
    out.push({
      label,
      availability: !v?.inStock ? "out_of_stock" : Number.isFinite(stock) && stock > 0 && stock <= 2 ? "low_on_stock" : "in_stock",
    });
  }
  return out;
}

/** Map one Elevate product (a colour of a product group). Pure. */
export function mapXxl(p: any, groupKey: string | null, country: CountryCode = "NO", site: string = SITE): ProductRecord | null {
  const title = String(p?.title ?? "").trim();
  const link = typeof p?.link === "string" ? p.link : null;
  if (!p?.key || !title || !link) return null;
  const vs: any[] = Array.isArray(p.variants) ? p.variants : [];
  // The price a shopper pays for the cheapest size still sold, with that size's own list price.
  const priced = vs
    .map((v) => ({ v, price: n(v?.sellingPrice), list: n(v?.listPrice) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  const pick =
    [...priced].sort((a, b) => Number(!!b.v.inStock) - Number(!!a.v.inStock) || a.price - b.price)[0] ??
    { price: n(p?.sellingPrice?.min), list: n(p?.listPrice?.max) };
  if (!Number.isFinite(pick.price) || pick.price <= 0) return null;
  const imgs: string[] = (p?.imageInfo?.images ?? [])
    .map((im: any) => im?.sources?.[0]?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const brand = typeof p.brand === "string" ? p.brand.trim() : "";
  const name = brand && !title.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${title}` : title;
  const sizes = sizesOf(vs);
  // "Trailjammer Short, turshorts, dame" — the middle part is the product type.
  const parts = title.split(",").map((s) => s.trim()).filter(Boolean);
  const type = parts.length >= 3 ? parts[parts.length - 2] : null;
  return {
    brand: "xxl",
    country,
    externalId: String(p.key),
    name,
    url: `${site}${link.split("?")[0]}`,
    imageUrl: imgs[0] ?? p?.imageInfo?.thumbnail ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.list) && pick.list > pick.price ? toMinor(pick.list) : null,
    currency: COUNTRIES[country].currency,
    inStock: p.inStock === true || vs.some((v) => v?.inStock === true),
    category: type ? type[0].toUpperCase() + type.slice(1) : null,
    gender: "kadin",
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey,
  };
}

export async function listXxl(country: CountryCode): Promise<ProductRecord[]> {
  const m = XXL_MARKETS[country];
  if (!m) return [];
  const keys = { customer: randomUUID(), session: randomUUID() };
  const body = JSON.stringify({ primaryList: { include: true, productRules: m.rule } });
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const d = await getJson<any>(xxlUrl(page * PAGE, keys, m), {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: m.site, Referer: `${m.site}/` },
      country,
    });
    const groups: any[] = d?.primaryList?.productGroups ?? [];
    if (!groups.length) break;
    let reduced = 0;
    for (const g of groups) {
      const prods: any[] = g?.products ?? [];
      const gk = prods.length > 1 && g?.key ? `xxl:${g.key}` : null;
      for (const p of prods) {
        const r = mapXxl(p, gk, country, m.site);
        if (r && r.listPrice != null) {
          reduced++;
          if (!byId.has(r.externalId)) byId.set(r.externalId, r);
        }
      }
    }
    // Sorted by discount: a page with no reduction means the sale is exhausted.
    if (reduced === 0 || byId.size >= CAP * 1.2) break;
    const total = Number(d?.primaryList?.totalHits ?? 0);
    if (total && (page + 1) * PAGE >= total) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
