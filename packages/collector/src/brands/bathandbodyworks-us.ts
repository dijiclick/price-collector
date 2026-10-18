/**
 * Bath & Body Works US (bathandbodyworks.com) through the Constructor.io index
 * its storefront browses with.
 *
 * The site is a Salesforce PWA Kit storefront behind PerimeterX (product pages
 * and the `/mobify/slas` token proxy answer the px-captcha page), but the
 * catalogue comes from Constructor (`ac.cnstrc.com`, public key in the page
 * config), which answers a GitHub runner directly (probe run 39135075578,
 * 2026-10-18: 200, all 1,823 products in the `root` group).
 *
 * Every product carries `price` (= `c_listPrice`, the shelf price) and, while
 * one of the store's own sale events is on, `c_salePrice` — the price the site
 * shows struck through to. On 2026-10-18 that was the "75% Off Select Items"
 * fall sale (`FallSale_75off_*` PRODUCT promotions, no coupon, the /c/sale
 * page): 491 products at 25% of list. A sale price is only taken when an
 * active, coupon-free product promotion stands behind it, so a stale field
 * never reads as a deal; multi-buys ("3/$33", "b3g1") carry no sale price and
 * are never deals here. Gift cards and test items have no price and drop out.
 *
 * `inventory.ats` is the online stock count. Most sale items sell out within
 * days, so in-stock rows are ranked first.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export const brand = "bathandbodyworks";
const HOST = "https://www.bathandbodyworks.com";
export const BBW_KEY = "key_KHDGYQMK0OhdRsv2";
const PER_PAGE = 200;
const MAX_PAGES = 15;
const CAP = Number(process.env.BBW_US_MAX_PRODUCTS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const bbwBrowseUrl = (page: number) =>
  `https://ac.cnstrc.com/browse/group_id/root?key=${BBW_KEY}&num_results_per_page=${PER_PAGE}&page=${page}&c=ciojs-client-2.0`;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
};

/** An automatic (no-code) product promotion running at `now`. */
export function hasLivePromo(promos: any[] | undefined, now = Date.now()): boolean {
  return (promos ?? []).some((p) => {
    if (p?.promotionClass !== "PRODUCT" || p?.basedOnCoupon !== false || p?.active === false) return false;
    const s = Date.parse(String(p.startDate ?? ""));
    const e = Date.parse(String(p.endDate ?? ""));
    return (!Number.isFinite(s) || s <= now) && (!Number.isFinite(e) || now < e);
  });
}

/**
 * Photo url, resized: the `hires` originals are ~350 KB, so they go through
 * SFCC's image service (realm BBDL), ~30 KB at 900 px.
 */
export function bbwPhoto(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  const path = u.startsWith("http") ? (() => { try { return new URL(u).pathname; } catch { return null; } })() : u;
  if (!path || !path.startsWith("/on/demandware.static/")) return u.startsWith("http") ? u : null;
  return `${HOST}/dw/image/v2/BBDL_PRD${path}?sw=900&sh=900&sm=fit`;
}

/** One Constructor result → record (sale-event markdowns only). Pure. */
export function mapBbwResult(res: any, country: CountryCode = "US", now = Date.now()): ProductRecord | null {
  const d = res?.data;
  if (!d?.id || !d?.url) return null;
  const list = num(d.c_listPrice ?? d.price);
  const shelf = num(d.price);
  const sale = num(d.c_salePrice);
  if (!(sale > 0) || !(list > sale) || !(shelf > sale) || !hasLivePromo(d.promotions, now)) return null;
  const name = decodeEntities(String(res.value ?? `${d.c_productName ?? ""} ${d.c_form ?? ""}`)).replace(/\s+/g, " ").trim();
  if (!name) return null;
  const photos = (d.imageGroups ?? [])
    .flatMap((g: any) => (g?.images ?? []).map((i: any) => bbwPhoto(i?.link)))
    .filter((u: string | null): u is string => !!u);
  const main = bbwPhoto(d.image_url) ?? photos[0] ?? null;
  const ats = num(d.inventory?.ats);
  return {
    brand,
    country,
    externalId: String(d.id),
    name,
    url: String(d.url).startsWith("http") ? String(d.url) : `${HOST}${d.url}`,
    imageUrl: main,
    images: cleanGallery(photos, main),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: ats > 0 && d.c_forceSoldOut !== true,
    category: (typeof d.c_productType === "string" && d.c_productType.trim()) || (typeof d.c_form === "string" && d.c_form.trim()) || null,
    gender: /\bmen'?s\b/i.test(`${d.c_className ?? ""} ${d.c_collection ?? ""}`) ? "erkek" : null,
    variants: null,
    groupKey: null,
    colorName: typeof d.c_fragranceName === "string" ? decodeEntities(d.c_fragranceName).trim() || null : null,
  };
}

export async function listBathAndBodyWorksUs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const rows: ProductRecord[] = [];
  const seen = new Set<string>();
  let total = Infinity;
  for (let page = 1; page <= MAX_PAGES && (page - 1) * PER_PAGE < total; page++) {
    if (page > 1) await sleep(400);
    const body = await getJson<any>(bbwBrowseUrl(page), { country });
    total = Number(body?.response?.total_num_results ?? 0);
    const results: any[] = body?.response?.results ?? [];
    if (!results.length) break;
    for (const r of results) {
      const rec = mapBbwResult(r, country);
      if (rec && !seen.has(rec.externalId)) {
        seen.add(rec.externalId);
        rows.push(rec);
      }
    }
  }
  if (!Number.isFinite(total) || total === 0) throw new Error(`bathandbodyworks/${country}: Constructor returned no catalogue`);
  // An empty list is legitimate between sale events (no throw): the catalogue answered.
  return rows.sort((a, b) => Number(b.inStock) - Number(a.inStock)).slice(0, CAP);
}
