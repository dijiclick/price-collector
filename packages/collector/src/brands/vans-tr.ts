import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { listRndCatalogue, rndGender, rndLimitsFromEnv, type RndShop } from "./_rnd";
import { INSIDER_CLIENT_ID, INSIDER_ENDPOINT, insiderGender } from "./_insider";

/**
 * Vans Turkey — www.vans.com.tr, an RND Commerce storefront (see _rnd.ts).
 * Same brand slug as the Australian adapter (vans.ts, Magento GraphQL) — the
 * registry picks this one for Turkey with `byMarket`.
 *
 * `/tum-outlet` is the sale (814 products on 2026-10-18, every one reduced);
 * the department trees carried no strike price at all (/kadin, /erkek page 1:
 * 0 of 96). ~17 pages. The cards' GA4 item gives section, type and colour.
 *
 * FULL CATALOGUE since 2026-10-19 (_rnd.ts listRndCatalogue): `/tum-urunler`
 * (2,000 colourway cards over 371 models on 2026-10-19 — the same 2,000 under
 * two different sorts, so the round count is not a search-window cap; every
 * stored row and all ~95 listings linked from the home page fall inside it)
 * at 200 cards a page, ~10 pages.
 *
 * WALLED since 2026-10-20: the host moved to RND's AWS stack (an
 * `rnd-stores-lb` ELB in eu-central-1, like The North Face) and its WAF answers
 * every page, robots.txt included, 405 to datacenter IPs — GitHub's runners and
 * a GCP sandbox alike — while a non-datacenter egress still gets 200. When the
 * storefront refuses, the run reads Vans' Insider feed instead (listVansInsider).
 * RE-PLATFORMED 2026-10-22: the listing no longer carries RND cards from any
 * IP and product urls end in the colourway SKU, so the feed is the route now;
 * its rows are keyed by that SKU (the old numeric-id rows are delisted once).
 */
export const SHOP: RndShop = {
  brand: "vans",
  site: "https://www.vans.com.tr",
  listings: [{ path: "/tum-outlet" }],
  detailPath: (id) => `/quicklook?productdescriptionid=${id}`,
  catalogue: [{ path: "/tum-urunler" }],
};

export const brand = SHOP.brand;

/**
 * Vans' Insider Smart Recommender feed (partner `vansrnd`, see _insider.ts),
 * which answers datacenter IPs. One row per COLOURWAY, in-stock only, and every
 * row's url ends in the same storefront product id the RND walk stores
 * (`/platform-old-skool-ayakkabi_124650`), so rows keep their ids across the
 * switch. 1,218 rows on 2026-10-21 against 1,220 in stock in the last good RND
 * walk — the whole in-stock catalogue, not a sample.
 *
 * No paging and `size` ≤ 100, so the catalogue is cut into price bands and a
 * band that comes back full is halved until none is. Sizes are not in the feed;
 * the upsert keeps the ones earlier quick-views stored.
 */
export const INSIDER_PARTNER = "vansrnd";
const BAND_TRY = 200;
const TOP_TRY = 100_000;
const MAX_REQUESTS = 400;
/** Each strategy draws from its own pool; most-popular alone missed ~20 rows. */
const STRATEGIES = ["most-popular", "new-arrivals"];
const PAUSE_MS = Number(process.env.INSIDER_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function vansInsiderUrl(lo: number, hi: number, strategy = "most-popular"): string {
  const q = new URLSearchParams({
    details: "true",
    locale: "tr_TR",
    currency: "TRY",
    partnerName: INSIDER_PARTNER,
    clientId: INSIDER_CLIENT_ID,
    size: "100",
    // `>` is strict, so the lower edge moves down half a kuruş: a price sitting
    // exactly on an edge belongs to the band above it, never to neither.
    filter: `([price.TRY][>][${Math.max(0, lo - 0.005)}])*([price.TRY][<][${hi}])`,
  });
  return `${INSIDER_ENDPOINT}/${strategy}?${q}`;
}

/** Map one feed row to the record the RND walk would have made. Pure. */
export function mapVansInsider(x: any): ProductRecord | null {
  const url = typeof x?.url === "string" ? x.url.split(/[?#]/)[0] : "";
  // Until 2026-10-21 urls ended in the storefront product id (`…-ayakkabi_124650`);
  // the re-platformed shop (10-22) ends them in the colourway SKU instead
  // (`/old-skool-ayakkabi-vn000d6wcjk1`, and the old url 301s there).
  const oldId = url.match(/^https:\/\/www\.vans\.com\.tr\/[^?#]*_(\d+)$/)?.[1];
  const sku = typeof x?.sku === "string" ? x.sku.trim() : "";
  const id =
    oldId ??
    (sku && /^https:\/\/www\.vans\.com\.tr\/[a-z0-9-]+$/.test(url) && url.endsWith(`-${sku.toLowerCase()}`) ? sku.toUpperCase() : undefined);
  const now = Number(x?.price?.TRY);
  const was = Number(x?.original_price?.TRY);
  const name = String(x?.name ?? "").replace(/\s+/g, " ").trim();
  if (!id || !name || !Number.isFinite(now) || now <= 0) return null;
  const cats: string[] = Array.isArray(x.category) ? x.category.map(String) : [];
  // Section > type > line, as in the card's GA4 item; a campaign or "No
  // Category" first level carries no type.
  const section = rndGender(cats[0]) != null || /^uni/i.test(cats[0] ?? "");
  const image = typeof x.image_url === "string" && x.image_url ? x.image_url : null;
  const colour = typeof x.color === "string" && x.color.trim() ? x.color.trim() : null;
  const code = typeof x.groupcode === "string" && x.groupcode ? x.groupcode : null;
  return {
    brand,
    country: "TR",
    externalId: id,
    name,
    url,
    imageUrl: image,
    images: cleanGallery([], image),
    price: toMinor(now),
    listPrice: Number.isFinite(was) && was - now > 0.005 ? toMinor(was) : null,
    currency: "TRY",
    inStock: x.in_stock !== 0 && Number(x.stock_count ?? 1) > 0,
    // The re-platformed feed carries the type alone (["Ayakkabı"]).
    category: section ? cats[1]?.trim() || null : !oldId && cats.length === 1 && !/no category/i.test(cats[0]) ? cats[0].trim() || null : null,
    gender: rndGender(cats[0]) ?? insiderGender(x.gender, null),
    variants: null,
    groupKey: code ? `${brand}:${code}` : null,
    colorName: colour,
  };
}

export async function listVansInsider(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  const bands: [string, number, number][] = [];
  for (const strategy of STRATEGIES)
    for (let lo = 0; lo < TOP_TRY; lo += lo < 12_000 ? BAND_TRY : TOP_TRY) bands.push([strategy, lo, lo < 12_000 ? lo + BAND_TRY : TOP_TRY]);
  let requests = 0;
  while (bands.length) {
    const [strategy, lo, hi] = bands.shift()!;
    if (++requests > MAX_REQUESTS) throw new Error(`vans: over ${MAX_REQUESTS} Insider requests — partial walk refused`);
    if (requests > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(vansInsiderUrl(lo, hi, strategy), { retries: 2, timeoutMs: 30_000 });
    if (!d?.success || !Array.isArray(d.data)) throw new Error(`vans: Insider band ${lo}–${hi} answered ${JSON.stringify(d).slice(0, 120)} — partial walk refused`);
    // A full band may hide more rows: split it, unless it is already one lira wide.
    if (d.data.length >= 100 && hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      bands.unshift([strategy, lo, mid], [strategy, mid, hi]);
      continue;
    }
    for (const x of d.data) {
      const r = mapVansInsider(x);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error("vans: Insider feed returned no products");
  return [...all.filter((r) => r.listPrice != null), ...all.filter((r) => r.listPrice == null)];
}


export async function listProducts(): Promise<ProductRecord[]> {
  try {
    return await listRndCatalogue(SHOP, rndLimitsFromEnv("VANS_TR", { maxProducts: 8000, maxPages: 50, detailLimit: 250, budgetMs: 170_000 }));
  } catch (err) {
    // Walled (405 to datacenter IPs) or re-platformed (10-22: no RND listing
    // markup left at all) — either way the feed is the whole in-stock shop.
    console.warn(`vans: storefront walk failed (${(err as Error).message}), reading the Insider feed`);
    return listVansInsider();
  }
}
