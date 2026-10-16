/**
 * Swarovski — outlet markdowns in US, CA, AU (swarovski.com) and AE
 * (swarovski.ae). Measured 2026-10-12.
 *
 * swarovski.com (SAP Commerce) is walled from GitHub runners. Its Baqend Speed
 * Kit cache is not: `swarovski.app.baqend.com/v1/asset/<page URL>` answers the
 * outlet listing with a plain GET as long as the request carries
 * `Origin: https://www.swarovski.com` (403 without it). The cache key wants the
 * current Speed Kit build — `bqcv` (first 8 hex of the service-worker `r=` id)
 * and `bqsk` (its `v=`) — read fresh each run from Speed Kit's install.js.
 *
 * - Listing: `/<locale>/c-swa-root/Categories/f/fg-shopby/fl-outlet
 *   ?sort=relevance&page=N` (0-based, 64 tiles a page, the page reports
 *   "N Results"). No trailing slash after `fl-outlet`. A page past the end, and
 *   now and then a cached error, come back 400; a throwaway query parameter
 *   gets a fresh copy. Since 2026-10-13 Baqend's own origin fetch is refused
 *   most of the time (fast 400, `server-timing: errorcode;desc=310`, ~1 fresh
 *   copy in 4 succeeds) and the refusal is then cached under the plain URL, so
 *   a 400 is retried with up to `FRESH_TRIES` fresh cache-busters.
 * - Stock: the tiles carry none. The "Available online" facet
 *   (`…/fl-outlet/productHasStockFlag/1`) lists the in-stock subset, so it is
 *   read first and everything else in the full listing is out of stock.
 * - Prices: `price-current` and `price-old` (the strikethrough) in the market's
 *   currency. Only US, CA and AU print a was-price; GB and CH show the outlet
 *   price with an "Outlet" label alone (no `price-old` on any tile), so they are
 *   not collected.
 * - Photos: `asset.swarovski.com` (Cloudinary), 200 image/jpeg from anywhere.
 * - No sizes: rings carry them only on the product page.
 *
 * swarovski.ae is a separate SFCC store (Cloudflare, no challenge):
 * `/swarovski-outlet?start=0&sz=300` returns the whole outlet (~285 tiles) in
 * one page, each with a sales price, a strike-through list price, stock and
 * the EAN in its GTM JSON.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

/** swarovski.com locale per market. GB/CH are left out on purpose (no was-price). */
export const SWAROVSKI_LOCALES: Partial<Record<CountryCode, string>> = {
  US: "en-US",
  CA: "en_GB-CA",
  AU: "en_GB-AU",
};
export const SWAROVSKI_MARKETS: CountryCode[] = [...(Object.keys(SWAROVSKI_LOCALES) as CountryCode[]), "AE"];

const SITE = "https://www.swarovski.com";
const BAQEND = "https://swarovski.app.baqend.com";
const INSTALL_JS = `${BAQEND}/v1/speedkit/install.js?d=production&o=${encodeURIComponent(SITE)}`;
/** Last seen build (2026-10-12) — used only if install.js cannot be read. */
const FALLBACK_BUILD = { bqcv: "22a0a3a5", bqsk: "2.22.5" };
const PAGE = 64;
const MAX_PAGES = 25;
const CAP = Number(process.env.SWAROVSKI_MAX_PRODUCTS ?? 1500);
const TIMEOUT = 30_000;
/** Fresh copies tried after a 400 — each fails fast (~0.3 s), ~1 in 4 succeeds. */
const FRESH_TRIES = 8;
const AE_HOST = "https://www.swarovski.ae";
const AE_PAGE = 300;
const IMAGE_WIDTH = "w_800";

export interface SpeedKitBuild {
  bqcv: string;
  bqsk: string;
}

/** `bqcv`/`bqsk` from Speed Kit's install.js (`wrapper-sw.js?r=<uuid>&v=<ver>`). */
export function parseBuild(js: string): SpeedKitBuild | null {
  const m = js.match(/wrapper-sw\.js\?r=([0-9a-f]{8})[0-9a-f-]*&(?:amp;)?v=([0-9][0-9.]*[0-9])/i);
  return m ? { bqcv: m[1], bqsk: m[2] } : null;
}

/** The listing path. `inStock` = the "Available online" facet. */
export function listingUrl(locale: string, page: number, build: SpeedKitBuild, inStock = false, bust?: string): string {
  // The Swiss German site names the root "Kategorien"; kept for when CH gets a was-price.
  const root = locale.startsWith("de-") ? "Kategorien" : "Categories";
  const path = `/${locale}/c-swa-root/${root}/f/fg-shopby/fl-outlet${inStock ? "/productHasStockFlag/1" : ""}`;
  const qs = `sort=relevance&page=${page}&showFragmentOnly=true${bust ? `&mdcb=${bust}` : ""}&bqcv=${build.bqcv}&bqsk=${build.bqsk}`;
  return `${BAQEND}/v1/asset/${SITE}${path}?${qs}`;
}

export const aeUrl = (start: number): string => `${AE_HOST}/swarovski-outlet?start=${start}&sz=${AE_PAGE}`;

const money = (s: string | undefined): number => {
  const n = parseFloat(decodeEntities(String(s ?? "")).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const text = (s: string | undefined): string => decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();

/** "748 Results" → 748. */
export const resultCount = (html: string): number => Number(html.match(/([\d,]+)\s+Results/)?.[1]?.replace(/,/g, "") ?? 0);

/** Cloudinary rendition at a fixed width (the tile ships 186–510 px). */
const bigger = (u: string) => u.replace(/,w_\d+\//, `,${IMAGE_WIDTH}/`).replace(/dpr_[\d.]+/, "dpr_1.0");

const SPLIT = '<div class="swa-product-tile-plp-wrapper">';

/**
 * One swarovski.com listing page → marked-down records. Pure. `inStock` is
 * filled in by the caller (the tile does not say).
 */
export function parseComPage(country: CountryCode, html: string): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const tile of html.split(SPLIT).slice(1)) {
    const id = tile.match(/data-gtm-product-variant="(\d+)"/)?.[1];
    const href = tile.match(/<a href="(\/[^"]+\/p-[^"]+)"/)?.[1];
    if (!id || !href) continue;
    const price = money(tile.match(/price-current[^"]*">([^<]*)</)?.[1]);
    const was = money(tile.match(/price-old[^"]*">([^<]*)</)?.[1]);
    if (!(price > 0) || !(was > price) || price < was * 0.1) continue;
    const title = text(tile.match(/information__title[^"]*">([^<]*)</)?.[1]);
    const subtitle = text(tile.match(/information__subtitle[^"]*">([^<]*)</)?.[1]);
    const imgs = [...tile.matchAll(/<img[^>]*?\ssrc="(https:\/\/asset\.swarovski\.com\/images\/[^"]+)"/g)]
      // Every photo in the tile is this product's (a ring's tile can show the
      // base size's photo, filed under a neighbouring article number).
      .map((m) => bigger(decodeEntities(m[1])));
    const master = tile.match(/data-gtm-product-id="([^"]+)"/)?.[1];
    out.push({
      brand: "swarovski",
      country,
      externalId: id,
      name: [title, subtitle].filter(Boolean).join(", "),
      url: `${SITE}${decodeEntities(href)}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: COUNTRIES[country].currency,
      inStock: true,
      category: null,
      gender: null,
      variants: null,
      // Colours of one design share the master ("M5725823") — the site's own grouping.
      groupKey: master && master !== id ? master : null,
      colorName: subtitle || null,
    });
  }
  return out;
}

/** Outlet category slug → a product-type word the classifier knows. */
const AE_CATEGORY: Record<string, string> = {
  "outlet-jewellery": "Jewellery",
  "outlet-watches": "Watches",
  "outlet-decorations": "Decorations",
  "outlet-pens": "Pens",
  "bangles-and-cuffs": "Bracelets",
};

/** One swarovski.ae outlet page → marked-down records. Pure. */
export function parseAePage(html: string): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const tile of html.split('class="js-product-tile-container').slice(1)) {
    const id = tile.match(/data-pid="([^"]+)"/)?.[1];
    const href = tile.match(/class="product-tile"\s+href="([^"]+)"/)?.[1];
    if (!id || !href) continue;
    const price = money(tile.match(/class="sales">\s*<span class="value" content="([\d.]+)"/)?.[1]);
    const was = money(tile.match(/class="strike-through[^"]*">\s*<span class="value"[^>]*content="([\d.]+)"/)?.[1]);
    if (!(price > 0) || !(was > price) || price < was * 0.1) continue;
    // The GTM JSON sits unescaped in the attribute, so read fields, not the JSON.
    const field = (k: string): string | undefined => {
      const m = tile.match(new RegExp(`"${k}":(?:"([^"]*)"|(true|false|null|[\\d.]+))`));
      return m ? (m[1] ?? m[2]) : undefined;
    };
    const name = text(field("item_name")) || text(tile.match(/title="([^"]+)"/)?.[1]);
    const ean = field("item_variant");
    const imgs = [...tile.matchAll(/<img[^>]*?\ssrc="(https:\/\/www\.swarovski\.ae\/dw\/image\/[^"]+)"/g)].map((m) =>
      decodeEntities(m[1]).replace(/\?sw=\d+&sh=\d+/, "?sw=800&sh=800"),
    );
    out.push({
      brand: "swarovski",
      country: "AE",
      externalId: id,
      name,
      url: `${AE_HOST}${decodeEntities(href)}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: COUNTRIES.AE.currency,
      inStock: field("item_in_stock") !== "false",
      barcodes: ean && /^\d{12,14}$/.test(ean) ? [ean] : null,
      category: AE_CATEGORY[field("item_category3") ?? ""] ?? null,
      gender: null,
      variants: null,
      groupKey: null,
      colorName: null,
    });
  }
  return out;
}

const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
const rank = (all: ProductRecord[]) =>
  all.sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a)).slice(0, CAP);

async function speedKitBuild(): Promise<SpeedKitBuild> {
  try {
    const b = parseBuild(await getText(INSTALL_JS, { country: "US", timeoutMs: TIMEOUT }));
    if (b) return b;
    console.warn("swarovski: Speed Kit build not found in install.js, using the last known one");
  } catch (err) {
    console.warn(`swarovski: install.js failed (${(err as Error).message}), using the last known build`);
  }
  return FALLBACK_BUILD;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `get(undefined)` (the plain cached URL), then on a 400/5xx up to `tries`
 * fresh copies `get(bust)`. Null when every copy answered 400 (also how a page
 * past the end looks). Pure apart from `get`/`wait`.
 */
export async function withFreshCopies(
  get: (bust?: string) => Promise<string>,
  tries = FRESH_TRIES,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<string | null> {
  let last: unknown;
  for (let i = 0; i <= tries; i++) {
    try {
      return await get(i === 0 ? undefined : `${Date.now().toString(36)}${i}`);
    } catch (err) {
      if (!/HTTP (400|5\d\d)/.test((err as Error).message)) throw err;
      last = err;
      if (i < tries) await wait(300 * Math.min(i + 1, 3));
    }
  }
  if (/HTTP 400/.test((last as Error).message)) return null;
  throw last;
}

/** One listing page; null when Baqend never served a copy. */
function fetchListing(country: CountryCode, locale: string, page: number, build: SpeedKitBuild, inStock: boolean) {
  const headers = { Origin: SITE, Referer: `${SITE}/`, Accept: "text/html" };
  return withFreshCopies((bust) => getText(listingUrl(locale, page, build, inStock, bust), { country, headers, timeoutMs: TIMEOUT }));
}

/** Every page of one listing (all of it, or the in-stock facet). */
async function readListing(country: CountryCode, locale: string, build: SpeedKitBuild, inStock: boolean) {
  const rows: ProductRecord[] = [];
  const ids = new Set<string>();
  let pages = MAX_PAGES;
  let total = 0;
  /** Pages inside the reported total that Baqend never served (skipped, not the end). */
  let missed = 0;
  for (let page = 0; page < pages; page++) {
    const html = await fetchListing(country, locale, page, build, inStock);
    if (html == null) {
      // Past page 0 the result count says how many pages exist, so a refused
      // page is a gap, not the end (2026-10-16: US/AU stuck at 128 = 2 pages).
      if (page > 0 && page < pages) { missed++; continue; }
      break;
    }
    if (page === 0) {
      total = resultCount(html);
      pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE)));
    }
    const tiles = html.split(SPLIT).length - 1;
    for (const m of html.matchAll(/data-gtm-product-variant="(\d+)"/g)) ids.add(m[1]);
    rows.push(...parseComPage(country, html));
    if (tiles === 0) break;
  }
  return { rows, ids, total, missed };
}

async function listCom(country: CountryCode, locale: string): Promise<ProductRecord[]> {
  const build = await speedKitBuild();
  // Stock first: a facet failure leaves every row "in stock" rather than losing the market.
  let stocked = await readListing(country, locale, build, true).catch((err) => {
    console.warn(`swarovski/${country}: in-stock facet failed (${(err as Error).message})`);
    return null;
  });
  // A facet that read nothing (refused on page 0) says nothing about stock.
  // Nor does one with refused pages: rows on those pages would read as sold out.
  if (stocked && (stocked.ids.size === 0 || stocked.missed > 0)) {
    console.warn(`swarovski/${country}: in-stock facet incomplete (${stocked.ids.size} tiles, ${stocked.missed} pages refused), stock left unknown`);
    stocked = null;
  }
  const all = await readListing(country, locale, build, false);
  const byId = new Map<string, ProductRecord>();
  for (const r of [...(stocked?.rows ?? []), ...all.rows]) {
    if (byId.has(r.externalId)) continue;
    r.inStock = !stocked || stocked.ids.has(r.externalId);
    byId.set(r.externalId, r);
  }
  if (byId.size === 0) {
    throw new Error(`swarovski/${country}: no marked-down products (${all.total} outlet results, ${all.ids.size} tiles read, build ${build.bqcv}/${build.bqsk})`);
  }
  return rank([...byId.values()]);
}

async function listAe(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let tiles = 0;
  for (let start = 0; start < AE_PAGE * 5; start += AE_PAGE) {
    const html = await getText(aeUrl(start), { country: "AE", headers: { Accept: "text/html" }, timeoutMs: 60_000 });
    const n = html.split('class="js-product-tile-container').length - 1;
    tiles += n;
    for (const r of parseAePage(html)) byId.set(r.externalId, r);
    if (n < AE_PAGE) break;
  }
  if (byId.size === 0) throw new Error(`swarovski/AE: no marked-down products (${tiles} outlet tiles)`);
  return rank([...byId.values()]);
}

export async function listSwarovski(country: CountryCode): Promise<ProductRecord[]> {
  if (country === "AE") return listAe();
  const locale = SWAROVSKI_LOCALES[country];
  if (!locale) return [];
  return listCom(country, locale);
}
