/**
 * Marks & Spencer UK (marksandspencer.com) — the British store, GBP. The
 * Turkish store is a separate Akinon shop (`marksandspencer.ts`); this file is
 * only the other market. 2026-10-11.
 *
 * Route: the clearance listing pages are a Next.js app whose server-rendered
 * `__NEXT_DATA__` carries the whole search result (48 hits a page, `?page=N`):
 * current price, `previousPrice` (the was price), brand, photos. They answer a
 * plain GET — no cookie, no key. The JSON API behind them
 * (`api.marksandspencer.com`) wants an Apigee key, so the page is the cleaner
 * public route.
 *
 * No sizes: a listing hit carries one representative SKU, not the size run —
 * the product page shows a dress listed as "size 8" holding stock in 6–18. A
 * per-product page fetch for ~1,500 rows is far over the request budget.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.marksandspencer.com";
const IMG = "https://assets.digitalcontent.marksandspencer.app/image/upload/w_1024,q_auto,f_auto/";
const PER_PAGE = 48;
const CAP = 1500;
const PAUSE_MS = Number(process.env.MS_INTL_PAUSE_MS ?? 900);
const MAX_PAGES = Number(process.env.MS_INTL_MAX_PAGES ?? 40);

/** Clearance trees, in priority order, each with its own share of the cap. */
export const MS_SECTIONS: { path: string; gender: ProductRecord["gender"]; max: number }[] = [
  { path: "/l/offers/clearance/womens-clearance", gender: "kadin", max: 1150 },
  { path: "/l/offers/clearance/lingerie-and-nightwear-clearance", gender: "kadin", max: 350 },
];

/**
 * Ireland (2026-10-21): the same Next.js listing under `/ie/…`, prices in EUR
 * (`price.currency` on every hit). Clearance there is small (~325 women's
 * hits, ~60% of them with a was price; no lingerie clearance tree).
 */
export const MS_SECTIONS_IE: { path: string; gender: ProductRecord["gender"]; max: number }[] = [
  { path: "/ie/l/offers/clearance/womens-clearance", gender: "kadin", max: 1000 },
  { path: "/ie/l/offers/clearance/mens-clearance", gender: "erkek", max: 500 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The search result object out of a listing page's `__NEXT_DATA__`. */
export function resultsOf(html: string): { products: any[]; totalItems: number } | null {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let d: any;
  try {
    d = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const r = d?.props?.pageProps?.serverSideGqlResponseFed?.productPageData?.search?.results;
  if (!r || !Array.isArray(r.products)) return null;
  return { products: r.products, totalItems: Number(r.totalItems) || 0 };
}

/** Map one listing hit. Pure. Only a single (not ranged) price can be a discount. */
export function mapMarksIntl(p: any, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const lp = p?.price?.listPrice;
  const price = Number(lp?.amount);
  const was = Number(p?.price?.previousPrice);
  if (!p?.id || !p?.title || !p?.seoPath || !Number.isFinite(price) || price <= 0) return null;
  const assets: any[] = (p.variants ?? []).flatMap((v: any) => v?.mediaAssets ?? []);
  const main = assets.find((a) => a?.type === "Main")?.assetId;
  const ids = [main, ...assets.map((a) => a?.assetId)].filter((x): x is string => typeof x === "string");
  const imgs = [...new Set(ids)].map((id) => IMG + id);
  const path = String(p.seoPath).replace(/&image=[^&]*/, "");
  const colour = /[?&]color=([^&]+)/.exec(path)?.[1] ?? null;
  return {
    brand: "marksandspencer",
    country,
    externalId: String(p.id),
    name: String(p.title).trim(),
    url: SITE + path,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    // The listing only shows sellable products.
    inStock: true,
    category: typeof p.productDefinition === "string" ? p.productDefinition : null,
    gender,
    variants: null,
    colorName: colour ? decodeURIComponent(colour) : null,
  };
}

async function page(url: string, country: CountryCode = "GB"): Promise<{ products: any[]; totalItems: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const html = await getText(url, { country, headers: { Accept: "text/html" } }).catch(() => null);
    const r = html ? resultsOf(html) : null;
    if (r) return r;
    await sleep(3000 * (attempt + 1));
  }
  return null;
}

export async function listMarksIntl(country: CountryCode): Promise<ProductRecord[]> {
  if (country === "IE") return listMarksIe();
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const s of MS_SECTIONS) {
    let taken = 0;
    for (let n = 1; n <= MAX_PAGES && taken < s.max && byId.size < CAP; n++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const r = await page(`${SITE}${s.path}${n > 1 ? `?page=${n}` : ""}`);
      if (!r) {
        if (requests === 1) throw new Error("marksandspencer/GB: clearance listing refused");
        break;
      }
      for (const p of r.products) {
        const rec = mapMarksIntl(p, country, s.gender);
        if (!rec || rec.listPrice == null || byId.has(rec.externalId)) continue;
        byId.set(rec.externalId, rec);
        if (++taken >= s.max || byId.size >= CAP) break;
      }
      if (r.products.length < PER_PAGE || n * PER_PAGE >= r.totalItems) break;
    }
  }
  return [...byId.values()];
}

/** Ireland: the GB flow over the `/ie` clearance trees; a non-EUR hit throws. */
async function listMarksIe(): Promise<ProductRecord[]> {
  const country: CountryCode = "IE";
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const s of MS_SECTIONS_IE) {
    let taken = 0;
    for (let n = 1; n <= MAX_PAGES && taken < s.max && byId.size < CAP; n++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const r = await page(`${SITE}${s.path}${n > 1 ? `?page=${n}` : ""}`, country);
      if (!r) {
        if (n === 1) throw new Error(`marksandspencer/IE: clearance listing refused (${s.path})`);
        throw new Error(`marksandspencer/IE: page ${n} of ${s.path} failed`);
      }
      for (const p of r.products) {
        if (p?.price?.currency && p.price.currency !== "EUR") throw new Error(`marksandspencer/IE: hit priced in ${p.price.currency}`);
        const rec = mapMarksIntl(p, country, s.gender);
        if (!rec || rec.listPrice == null || byId.has(rec.externalId)) continue;
        byId.set(rec.externalId, rec);
        if (++taken >= s.max || byId.size >= CAP) break;
      }
      if (r.products.length < PER_PAGE || n * PER_PAGE >= r.totalItems) break;
    }
  }
  return [...byId.values()];
}
