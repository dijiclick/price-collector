/**
 * Swarovski Turkey — the tr-TR outlet on swarovski.com (2026-10-18).
 *
 * Same route as the US/CA/AU adapter (swarovski.ts): swarovski.com (Akamai)
 * answers 403 to GitHub's runners and to curl, but its Baqend Speed Kit cache
 * serves the outlet listing with a plain GET carrying
 * `Origin: https://www.swarovski.com`. Probe run 39124363303: 3 of 6 fresh
 * copies 200 (1.1 MB), the rest a fast 400 — retried with cache-busters
 * exactly like the other markets (`withFreshCopies`).
 *
 * What differs in Turkey, and why this is its own file:
 * - The root category is `Kategoriler` (`/tr-TR/c-swa-root/Categories/…`
 *   answers 400 every time), so the listing path is
 *   `/tr-TR/c-swa-root/Kategoriler/f/fg-shopby/fl-outlet`.
 * - Prices print Turkish style (`2.793 ₺`, `12.345,50 ₺`): the dot is the
 *   thousands separator. The en-locale parser would read `2.793` as 2.79.
 * - The result count reads "527 Sonuç", not "527 Results".
 * TR prints a strike price on every outlet tile (64 of 64 on page 0), unlike
 * GB/CH.
 *
 * Speed Kit build: install.js now answers its "challenge" stub unless the
 * request says `es=modern`; the real script carries `wrapper-sw.js?r=…&v=…`.
 *
 * Stock: the "Available online" facet (`/productHasStockFlag/1`) is read
 * first, as for the other markets; rows outside it are out of stock. No sizes
 * on the tiles.
 *
 * FULL CATALOGUE since 2026-10-19 (listProducts): the in-stock facets of the
 * outlet (523 on 2026-10-19) and of the `Kategoriler` root (1,208 of 1,400 —
 * the four top categories sum to 1,402, so 1,400 is not a cap) are walked,
 * ~29 pages of 64, and every tile is kept: outlet markdowns with their strike
 * price exactly as before, the rest as full-price rows (`listPrice` null).
 * Rows outside both facets are out of stock, which the collector's delist
 * sweep records. A page Baqend never serves, a walk short of a facet's own
 * count (1% allowed) or a cap fails the run instead of returning part of the
 * shop. `listOutlet` keeps the old outlet-only walk.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { decodeEntities } from "./_sfcchtml";
import { parseBuild, withFreshCopies, type SpeedKitBuild } from "./swarovski";

export const brand = "swarovski";

const SITE = "https://www.swarovski.com";
const BAQEND = "https://swarovski.app.baqend.com";
const LOCALE = "tr-TR";
const INSTALL_JS = `${BAQEND}/v1/speedkit/install.js?d=production&o=${encodeURIComponent(SITE)}&es=modern`;
/** Last seen build (2026-10-18) — used only if install.js cannot be read. */
const FALLBACK_BUILD: SpeedKitBuild = { bqcv: "22a0a3a5", bqsk: "2.22.5" };
const PAGE = 64;
const MAX_PAGES = Number(process.env.SWAROVSKI_TR_MAX_PAGES ?? 15);
const CAP = Number(process.env.SWAROVSKI_TR_MAX_PRODUCTS ?? 1500);
/** Catalogue walk: ~19 pages today; room for the shop to double. */
const CATALOGUE_MAX_PAGES = Number(process.env.SWAROVSKI_TR_CATALOGUE_MAX_PAGES ?? 60);
const CATALOGUE_CAP = Number(process.env.SWAROVSKI_TR_CATALOGUE_MAX_PRODUCTS ?? 4000);
const TIMEOUT = 30_000;
const PAUSE_MS = 400;
const IMAGE_WIDTH = "w_800";
const SPLIT = '<div class="swa-product-tile-plp-wrapper">';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "2.793 ₺" → 2793, "12.345,50 ₺" → 12345.5. NaN when there is no number. */
export function trMoney(s: string | undefined): number {
  const t = decodeEntities(String(s ?? "")).replace(/[^\d.,]/g, "");
  if (!/\d/.test(t)) return NaN;
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** "527 Sonuç" → 527, "1.400 Sonuç" → 1400. */
export const trResultCount = (html: string): number =>
  Number(html.match(/([\d.]+)\s+Sonuç/)?.[1]?.replace(/\./g, "") ?? 0);

export function trListingUrl(page: number, build: SpeedKitBuild, inStock = false, bust?: string, whole = false): string {
  const facets = `${whole ? "" : "/fg-shopby/fl-outlet"}${inStock ? "/productHasStockFlag/1" : ""}`;
  const path = `/${LOCALE}/c-swa-root/Kategoriler${facets ? `/f${facets}` : ""}`;
  const qs = `sort=relevance&page=${page}&showFragmentOnly=true${bust ? `&mdcb=${bust}` : ""}&bqcv=${build.bqcv}&bqsk=${build.bqsk}`;
  return `${BAQEND}/v1/asset/${SITE}${path}?${qs}`;
}

const text = (s: string | undefined): string => decodeEntities(String(s ?? "")).replace(/\s+/g, " ").trim();
const bigger = (u: string) => u.replace(/,w_\d+\//, `,${IMAGE_WIDTH}/`).replace(/dpr_[\d.]+/, "dpr_1.0");

/**
 * One tr-TR listing page → marked-down records (inStock filled in by the
 * caller). Pure. With `fullPrice`, unreduced tiles come back too, as
 * full-price rows (`listPrice` null).
 */
export function parseTrPage(html: string, opts: { fullPrice?: boolean } = {}): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const tile of html.split(SPLIT).slice(1)) {
    const id = tile.match(/data-gtm-product-variant="(\d+)"/)?.[1];
    const href = tile.match(/<a href="(\/tr-TR\/[^"]*p-[^"]+)"/)?.[1];
    if (!id || !href) continue;
    // The GTM attribute is machine-formatted ("3913.00"); the label is the fallback.
    const gtm = parseFloat(tile.match(/data-gtm-product-price="([\d.]+)"/)?.[1] ?? "");
    const price = Number.isFinite(gtm) && gtm > 0 ? gtm : trMoney(tile.match(/price-current[^"]*">([^<]*)</)?.[1]);
    const was = trMoney(tile.match(/price-old[^"]*">([^<]*)</)?.[1]);
    if (!(price > 0)) continue;
    const reduced = was > price && price >= was * 0.1;
    if (!reduced && !opts.fullPrice) continue;
    const title = text(tile.match(/information__title[^"]*">([^<]*)</)?.[1]);
    const subtitle = text(tile.match(/information__subtitle[^"]*">([^<]*)</)?.[1]);
    const imgs = [...tile.matchAll(/<img[^>]*?\ssrc="(https:\/\/asset\.swarovski\.com\/images\/[^"]+)"/g)].map((m) =>
      bigger(decodeEntities(m[1])),
    );
    const master = tile.match(/data-gtm-product-id="([^"]+)"/)?.[1];
    out.push({
      brand,
      country: "TR",
      externalId: id,
      name: [title, subtitle].filter(Boolean).join(", "),
      url: `${SITE}${decodeEntities(href)}`,
      imageUrl: imgs[0] ?? null,
      images: cleanGallery(imgs, imgs[0] ?? null),
      price: toMinor(price),
      listPrice: reduced ? toMinor(was) : null,
      currency: "TRY",
      inStock: true,
      category: null,
      gender: null,
      variants: null,
      groupKey: master && master !== id ? master : null,
      colorName: subtitle || null,
    });
  }
  return out;
}

async function speedKitBuild(): Promise<SpeedKitBuild> {
  try {
    const b = parseBuild(await getText(INSTALL_JS, { timeoutMs: TIMEOUT }));
    if (b) return b;
    console.warn("swarovski/TR: Speed Kit build not found in install.js, using the last known one");
  } catch (err) {
    console.warn(`swarovski/TR: install.js failed (${(err as Error).message}), using the last known build`);
  }
  return FALLBACK_BUILD;
}

function fetchListing(page: number, build: SpeedKitBuild, inStock: boolean, whole = false) {
  const headers = { Origin: SITE, Referer: `${SITE}/`, Accept: "text/html" };
  return withFreshCopies((bust) => getText(trListingUrl(page, build, inStock, bust, whole), { headers, timeoutMs: TIMEOUT }));
}

async function readListing(build: SpeedKitBuild, inStock: boolean) {
  const rows: ProductRecord[] = [];
  const ids = new Set<string>();
  let pages = MAX_PAGES;
  let total = 0;
  let missed = 0;
  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const html = await fetchListing(page, build, inStock);
    if (html == null) {
      // Past page 0 the result count says how many pages exist: a refusal is a gap.
      if (page > 0) { missed++; continue; }
      break;
    }
    if (page === 0) {
      total = trResultCount(html);
      pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE)));
    }
    const tiles = html.split(SPLIT).length - 1;
    for (const m of html.matchAll(/data-gtm-product-variant="(\d+)"/g)) ids.add(m[1]);
    rows.push(...parseTrPage(html));
    if (tiles === 0) break;
  }
  return { rows, ids, total, missed };
}

const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;

/** Every tile of one listing's in-stock facet; throws rather than return part of it. */
async function walkInStock(build: SpeedKitBuild, whole: boolean): Promise<ProductRecord[]> {
  const what = whole ? "catalogue" : "outlet";
  const rows: ProductRecord[] = [];
  const ids = new Set<string>();
  let pages = 1;
  let total = 0;
  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    const html = await fetchListing(page, build, true, whole);
    if (html == null) throw new Error(`swarovski/TR: ${what} page ${page} never served (build ${build.bqcv}/${build.bqsk}) — partial walk refused`);
    if (page === 0) {
      total = trResultCount(html);
      if (total <= 0) throw new Error(`swarovski/TR: no result count on the ${what} (build ${build.bqcv}/${build.bqsk})`);
      pages = Math.ceil(total / PAGE);
      if (pages > CATALOGUE_MAX_PAGES) throw new Error(`swarovski/TR: ${pages} ${what} pages, over ${CATALOGUE_MAX_PAGES}`);
    }
    for (const r of parseTrPage(html, { fullPrice: true })) {
      if (ids.has(r.externalId)) continue;
      ids.add(r.externalId);
      rows.push(r);
    }
  }
  if (ids.size < total * 0.99) throw new Error(`swarovski/TR: ${ids.size} of ${total} in-stock ${what} tiles — partial walk refused`);
  return rows;
}

/**
 * The whole in-stock shop: the outlet's in-stock facet (its markdowns, as
 * before) plus the `Kategoriler` root's — the root does NOT list the outlet
 * (519 of 520 stored outlet rows are absent from it), so both are walked.
 * An id in both keeps its outlet row.
 */
export async function listProducts(): Promise<ProductRecord[]> {
  const build = await speedKitBuild();
  const byId = new Map<string, ProductRecord>();
  for (const r of await walkInStock(build, false)) byId.set(r.externalId, r);
  for (const r of await walkInStock(build, true)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
  if (byId.size > CATALOGUE_CAP) throw new Error(`swarovski/TR: ${byId.size} products, over the cap of ${CATALOGUE_CAP}`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.listPrice != null).sort((a, z) => off(z) - off(a)), ...all.filter((r) => r.listPrice == null)];
}

/** The outlet only (the walk before 2026-10-19): marked-down tiles, in-stock facet first. */
export async function listOutlet(): Promise<ProductRecord[]> {
  const build = await speedKitBuild();
  let stocked = await readListing(build, true).catch((err) => {
    console.warn(`swarovski/TR: in-stock facet failed (${(err as Error).message})`);
    return null;
  });
  if (stocked && (stocked.ids.size === 0 || stocked.missed > 0)) {
    console.warn(`swarovski/TR: in-stock facet incomplete (${stocked.ids.size} tiles, ${stocked.missed} pages refused), stock left unknown`);
    stocked = null;
  }
  // The facet IS the outlet when it lists as many results; the second walk adds nothing.
  const all = stocked && stocked.total > 0 && stocked.ids.size >= stocked.total ? stocked : await readListing(build, false);
  const byId = new Map<string, ProductRecord>();
  for (const r of [...(stocked?.rows ?? []), ...all.rows]) {
    if (byId.has(r.externalId)) continue;
    r.inStock = !stocked || stocked.ids.has(r.externalId);
    byId.set(r.externalId, r);
  }
  if (byId.size === 0) {
    throw new Error(`swarovski/TR: no marked-down products (${all.total} outlet results, ${all.ids.size} tiles read, build ${build.bqcv}/${build.bqsk})`);
  }
  return [...byId.values()]
    .sort((a, z) => Number(z.inStock) - Number(a.inStock) || off(z) - off(a))
    .slice(0, CAP);
}
