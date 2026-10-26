/**
 * Apotea — Sweden's biggest online pharmacy (apotea.se), beauty/personal care
 * only, 2026-10-21.
 *
 * www.apotea.se is Cloudflare-walled (403 even from the Mac). The Android app
 * (`se.apotea.app`, jadx) talks to its own API outside the wall:
 *   https://appapi.apotea.se/api/…  with an `okhttp/4.12.0` User-Agent
 * (GitHub runner probe 39634668018: 200 for banner + search).
 *
 *   GET  /api/banner?type=search-Veckans-kampanjer → the week's campaigns, each
 *        a path that is either a promotion or a brand page.
 *   GET  /api/brands → every brand path (tells the two apart).
 *   POST /api/search {query, categoryPath, brandPath, promotionPath, page,
 *        sorting, filter[]} → 60 articles a page + `hasNextPage` + facets
 *        (`cat_6` = the top-level categories present).
 *
 * Prices: an article on a real markdown has `campaignPrice > 0` and
 * `lowest_price` above it — that is the "Tidigare pris" (Omnibus 30-day
 * lowest) the product page strikes. Multi-buy deals ("Köp 2 få 30%") carry
 * `campaignPrice: 0` and are dropped; so are medicines (`isMedicine`).
 *
 * Beauty only: a campaign is read whole when every top-level category it spans
 * is beauty/personal care (or travel/premium); a brand campaign that also
 * spans health categories is read per beauty category via a brand filter
 * (`categoryPath` + `filter: brand=<path>`); a mixed non-brand promotion is
 * skipped (supplements, pharmacy, household, food, pets never pass).
 *
 * Photos: media.apotea.se sits behind a Cloudflare rule that challenges every
 * request from outside Sweden (check-host.net 2026-10-22: 200 from SE only,
 * 403 from IT/DE/FR/NL/US/TR). media.apotea.no is the Norwegian shop's media
 * host on Apotea's own origin (no Cloudflare): the same `/product-images/`
 * paths answer 200 from every country, any client, no Referer.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const API = "https://appapi.apotea.se/api";
const SITE = "https://www.apotea.se";
const HEADERS = { "User-Agent": "okhttp/4.12.0" };
const PAUSE_MS = Number(process.env.APOTEA_PAUSE_MS ?? 400);
const MAX_REQUESTS = 90;
const MAX_PAGES = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thrown when a run has spent MAX_REQUESTS; the walk keeps what it read. */
class RequestCap extends Error {}

/** Apotea's top-level categories that are beauty / personal care. */
export const APOTEA_BEAUTY = new Set([
  "ansikte", "harvard", "smink", "kroppsvard", "solskydd",
  "hander-fotter", "harborttagning-rakning", "dermatologisk-hudvard",
]);
/** Neutral sections a beauty campaign may also show up in (travel sizes, Premium). */
const NEUTRAL = new Set(["resa", "premium-2"]);

/** Large photo on the unwalled .no media host (see the header). Pure. */
export const apoteaImage = (url: string): string =>
  url.replace("://media.apotea.se/", "://media.apotea.no/").replace("/product-images/M/", "/product-images/L/");

const num = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

/** Map one search article. Pure. Returns only real markdowns of non-medicines. */
export function mapApotea(a: any, country: CountryCode = "SE"): ProductRecord | null {
  const id = a?.id != null ? String(a.id) : "";
  const name = String(a?.name ?? "").trim();
  const path = typeof a?.path === "string" ? a.path.trim() : "";
  if (!id || !name || !path || a?.isMedicine) return null;
  const price = num(a?.campaignPrice);
  const was = num(a?.lowest_price);
  if (!(price > 0) || !(was > price)) return null;
  const img = typeof a?.imageUrl === "string" && a.imageUrl ? apoteaImage(a.imageUrl) : null;
  return {
    brand: "apotea",
    country,
    externalId: id,
    name,
    url: `${SITE}/${path}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: a?.isPurchasable === true,
    category: null,
    gender: null,
    variants: null,
    groupKey: null,
  };
}

/** The top-level category paths a search response spans. */
export function apoteaCats(d: any): string[] {
  const opt = (d?.possibleFilters?.options ?? []).find((o: any) => o?.id === "cat_6");
  return (opt?.values ?? []).map((v: any) => String(v?.id ?? "")).filter(Boolean);
}

/** How to read one campaign: whole, per beauty category (brand only), or not at all. */
export function apoteaPlan(cats: string[], isBrand: boolean): "all" | "split" | "skip" {
  if (!cats.length) return "skip";
  if (cats.every((c) => APOTEA_BEAUTY.has(c) || NEUTRAL.has(c))) return "all";
  if (isBrand && cats.some((c) => APOTEA_BEAUTY.has(c))) return "split";
  return "skip";
}

/** Campaign paths from the week's banner list (app-internal links only). */
export function apoteaCampaignPaths(banner: any): string[] {
  const out: string[] = [];
  for (const it of banner?.items ?? []) {
    const p = typeof it?.path === "string" ? it.path.trim() : "";
    if (p && !p.startsWith("/") && !/^https?:/.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

export async function listApotea(country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  if (country !== "SE") return [];
  let requests = 0;
  const get = async <T = any>(url: string, body?: unknown): Promise<T> => {
    if (requests >= MAX_REQUESTS) throw new RequestCap(`apotea/${country}: request cap ${MAX_REQUESTS} reached`);
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    return getJson<T>(url, body === undefined
      ? { headers: HEADERS, country, retries: 1 }
      : { method: "POST", body: JSON.stringify(body), headers: { ...HEADERS, "Content-Type": "application/json" }, country, retries: 1 });
  };
  const search = (q: Partial<Record<string, unknown>>, page: number) =>
    get<any>(`${API}/search`, { query: "", categoryPath: "", brandPath: "", promotionPath: "", sorting: "popular", filter: [], ...q, page });

  const byId = new Map<string, ProductRecord>();
  const take = (d: any) => {
    for (const a of d?.articles ?? []) {
      const r = mapApotea(a, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  };
  /** Page 2.. of a source until it runs out (page 1 already read). */
  const rest = async (q: Partial<Record<string, unknown>>, first: any, label: string) => {
    let d = first;
    for (let page = 2; d?.hasNextPage && byId.size < cap; page++) {
      if (page > MAX_PAGES) throw new Error(`apotea/${country}: ${label} has more than ${MAX_PAGES} pages`);
      d = await search(q, page);
      take(d);
    }
  };

  const paths = apoteaCampaignPaths(await get(`${API}/banner?type=search-Veckans-kampanjer`));
  if (!paths.length) throw new Error(`apotea/${country}: no campaigns in the banner list`);
  const brands = new Set<string>(((await get<any>(`${API}/brands`))?.items ?? []).map((b: any) => String(b?.path ?? "")));

  // The banner lists the week's campaigns in Apotea's own order (68 on
  // 2026-10-26, against ~20 when this was written), so reading page 1 of each
  // alone can spend the cap. Spending it ends the walk with the campaigns
  // already read rather than throwing them away; the same campaigns come
  // first every run, so the feed stays stable.
  let read = 0;
  try {
    for (const path of paths) {
      if (byId.size >= cap) break;
      const isBrand = brands.has(path);
      const q = isBrand ? { brandPath: path } : { promotionPath: path };
      const d = await search(q, 1);
      const arts: any[] = d?.articles ?? [];
      // No campaign price on the first page = a multi-buy / gift / info banner.
      if (!arts.some((a) => num(a?.campaignPrice) > 0)) continue;
      const plan = apoteaPlan(apoteaCats(d), isBrand);
      if (plan === "all") {
        read++;
        take(d);
        await rest(q, d, path);
      } else if (plan === "split") {
        read++;
        for (const cat of apoteaCats(d).filter((c) => APOTEA_BEAUTY.has(c))) {
          const cq = { categoryPath: cat, filter: [{ key: "brand", value: path }] };
          const c1 = await search(cq, 1);
          take(c1);
          await rest(cq, c1, `${path}/${cat}`);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof RequestCap) || !byId.size) throw err;
    console.log(`${(err as Error).message}; keeping ${byId.size} deals from ${read} campaigns`);
  }
  if (!read) throw new Error(`apotea/${country}: none of ${paths.length} campaigns is a beauty markdown`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
