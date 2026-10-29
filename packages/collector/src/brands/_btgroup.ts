/**
 * Brown Thomas and Arnotts (Ireland, EUR) — the Selfridges-group department
 * stores, both Salesforce Commerce Cloud (SiteGenesis) sites `BrownThomas` /
 * `arnotts-global`. Measured 2026-10-21.
 *
 * Route: the sale category pages with `?sz=100&start=N&format=page-element`
 * (the grid fragment the site's own infinite scroll loads). Cloudflare sits in
 * front without a challenge; GitHub runners get the same 200 (probe run
 * 39634392109). Every tile carries its whole model as JSON in
 * `data-component-product-tile`: name, brand, URLs, photos, the "Was"
 * (`isList`) and "Now" (`isSale`) prices the tile prints, per-size
 * `isSelectable`, and an availability class.
 *
 * Only tiles whose own Was is above Now are kept — nothing is inferred. In
 * Oct 2026 most sale rows are an "up to 25% off" store event (10/20/25%) plus
 * end-of-season markdowns; both print Was/Now on the tile.
 *
 * Home, electrical, toys and nursery are dropped (the gtm `item_category` /
 * `item_category2` the tile also carries); the brand on the tile is the maker.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { decodeEntities } from "./_sfcchtml";

export type BtGroupBrand = "brownthomas" | "arnotts";

interface Section { path: string; gender: ProductRecord["gender"]; max: number }
interface Site { host: string; sections: Section[] }

/** Sale trees, in priority order, each with its share of the cap. */
export const BT_SITES: Record<BtGroupBrand, Site> = {
  brownthomas: {
    host: "https://www.brownthomas.com",
    sections: [
      { path: "/sale/womens-sale/", gender: "kadin", max: 300 },
      { path: "/sale/mens-sale/", gender: "erkek", max: 200 },
      { path: "/sale/shoes-sale/", gender: "kadin", max: 100 },
      { path: "/sale/bags-accessories/", gender: "kadin", max: 100 },
      { path: "/sale/beauty/", gender: null, max: 100 },
    ],
  },
  arnotts: {
    host: "https://www.arnotts.ie",
    sections: [
      { path: "/sale/womens-sale/", gender: "kadin", max: 300 },
      { path: "/sale/mens-sale/", gender: "erkek", max: 200 },
      { path: "/sale/womens-bags-accessories-sale/", gender: "kadin", max: 100 },
      { path: "/sale/beauty/", gender: null, max: 100 },
      { path: "/sale/kids-sale-2/", gender: "cocuk", max: 100 },
    ],
  },
};

/**
 * An uncached 100-tile page takes ~15 s to render server-side (200 tiles up to
 * ~50 s), so each store is capped at 8 pages / 800 rows to stay inside the
 * 3-minute budget. Each section reads at most ceil(max / PAGE) pages.
 */
const PAGE = 100;
const CAP = 800;
const MAX_REQUESTS = 10;
const PAUSE_MS = Number(process.env.BTGROUP_PAUSE_MS ?? 900);
/** Retry waits for a refused page (scaled by BTGROUP_PAUSE_MS so tests run instant). */
const RETRY_WAITS = [2_000, 5_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cloudflare fronts both stores without a challenge and serves GitHub runners
 * (probe run 40863521475, both sale grids 200), but it refuses the odd request
 * with a one-off 403/429 — brownthomas and arnotts each 403'd a single run on
 * 2026-10-29 10:00 and recovered on the next. `getText` has no retry of its own,
 * and a refusal on a section's first page throws away the whole brand, so ask a
 * refused page again after a short back-off before giving up.
 */
async function btGetText(url: string, country: CountryCode, host: string, path: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
    if (attempt > 0) await sleep((RETRY_WAITS[attempt - 1] * PAUSE_MS) / 900);
    try {
      return await getText(url, { country, timeoutMs: 40_000, headers: { Accept: "text/html", Referer: `${host}${path}` } });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

const ALLOWED_TOP = new Set(["women", "men", "kids", "beauty"]);
const DROP_SUB = /toy|game|nursery|lego|teddy|home|electrical|furniture|candle|book/i;

export function btPageUrl(brand: BtGroupBrand, path: string, start: number): string {
  return `${BT_SITES[brand].host}${path}?sz=${PAGE}&start=${start}&format=page-element`;
}

/** Every tile model on a grid page, in order. Pure. */
export function tilesOf(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/data-component-product-tile='([^']*)'/g)) {
    try {
      out.push(JSON.parse(decodeEntities(m[1])));
    } catch {
      /* a malformed tile is skipped */
    }
  }
  return out;
}

const genderOf = (top: string | undefined, fallback: ProductRecord["gender"]): ProductRecord["gender"] =>
  top === "women" ? "kadin" : top === "men" ? "erkek" : top === "kids" ? "cocuk" : top === "beauty" ? null : fallback;

/** Map one tile model. Pure; null unless the tile prints a Was above its Now. */
export function mapBtTile(brand: BtGroupBrand, country: CountryCode, tile: any, fallback: ProductRecord["gender"]): ProductRecord | null {
  const p = tile?.product;
  if (!p?.ID || !p?.name || !p?.urls?.product) return null;
  if (p.flags?.isPriceRange || p.flags?.isGiftCard || p.flags?.productDoNotSell) return null;
  const prices: any[] = Array.isArray(p.prices) ? p.prices : [];
  const was = Number(prices.find((x) => x?.isList)?.price);
  const now = Number(prices.find((x) => x?.isSale)?.price);
  if (!(now > 0) || !(was > now)) return null;

  let gtm: any = {};
  try {
    gtm = typeof p.gtmData === "string" ? JSON.parse(p.gtmData) : {};
  } catch {
    gtm = {};
  }
  const top = typeof gtm.item_category === "string" ? gtm.item_category.toLowerCase() : undefined;
  if (top && !ALLOWED_TOP.has(top)) return null;
  if (DROP_SUB.test(String(gtm.item_category2 ?? ""))) return null;

  const img = (k: "primary" | "secondary") => p.images?.[k]?.large?.url ?? p.images?.[k]?.medium?.url;
  const imgs = [img("primary"), img("secondary")].filter((u): u is string => typeof u === "string" && u.startsWith("http"));

  const sizes: SizeVariant[] = [];
  for (const s of p.variationAttributes?.size?.list ?? []) {
    const label = String(s?.displayValue ?? s?.value ?? "").trim();
    if (!label || sizes.some((x) => x.label === label)) continue;
    sizes.push({ label, availability: s.isSelectable ? "in_stock" : "out_of_stock" });
  }
  const avail = String(p.availability?.availabilityClass ?? "");
  const inStock = p.availability?.isNotAvailable === true ? false
    : sizes.length ? sizes.some((s) => s.availability === "in_stock")
    : /in-stock|low-stock/.test(avail) || p.flags?.isAvailable === true;
  const url = String(p.urls.product).replace(/\?cgid=[^&]*$/, "");
  const maker = typeof p.brand === "string" && p.brand.trim() ? p.brand.trim() : null;
  return {
    brand,
    country,
    externalId: String(p.ID),
    name: decodeEntities(String(p.name)).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock,
    category: [gtm.item_category2, gtm.item_list_name].filter((x) => typeof x === "string" && x).join(" / ") || null,
    maker,
    gender: genderOf(top, fallback),
    variants: sizes.length && !(sizes.length === 1 && /^one size$/i.test(sizes[0].label)) ? { colors: [], sizes } : null,
  };
}

/** Register as `listBtGroup("brownthomas" | "arnotts", country)`. Ireland only. */
export async function listBtGroup(brand: BtGroupBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IE") return [];
  const site = BT_SITES[brand];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const s of site.sections) {
    let taken = 0;
    const pages = Math.ceil(s.max / PAGE);
    for (let start = 0; start < pages * PAGE && taken < s.max && byId.size < CAP; start += PAGE) {
      if (requests >= MAX_REQUESTS) throw new Error(`${brand}/IE: request budget (${MAX_REQUESTS}) spent before the cap`);
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await btGetText(btPageUrl(brand, s.path, start), country, site.host, s.path);
      const tiles = tilesOf(html);
      if (!tiles.length) {
        if (start === 0) throw new Error(`${brand}/IE: no tiles on ${s.path}`);
        break;
      }
      for (const t of tiles) {
        const r = mapBtTile(brand, country, t, s.gender);
        if (!r || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        if (++taken >= s.max || byId.size >= CAP) break;
      }
      if (tiles.length < PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}
