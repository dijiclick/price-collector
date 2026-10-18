/**
 * Kohl's (kohls.com) — US only.
 *
 * Every kohls.com page, m.kohls.com and the app's product/category endpoints
 * answer Akamai "Access Denied" to datacenter egress, and everything Kohl's
 * owns 403s from Turkey and the Hetzner box. The Android app's catalog search
 * (`mapps.kohls.com/api/browse/v1/browse/catalog`, found in the APK —
 * com.kohls.mcommerce.opal 26.10.3, `MSPProductForDimensionService`) is not
 * walled for US datacenter egress when the request carries a browser UA:
 * 200 JSON from a GitHub runner (probe run 39135448486, 2026-10-18,
 * 266 KB for 48 hits). The app's own `okhttp` UA is refused there, and so is
 * the dimension form of the same endpoint (`/catalog/Promotions:Sale…`) — so
 * walks are keyword searches, the same ones a shopper types.
 *
 * One request = one page of up to 120 hits (`limit`, 1-based `offset`).
 *
 * Prices: `prices[0]` is the shelf price. Kept only when `regularPrice` and
 * `salePrice` are single values (`maxPrice` null) with sale < regular, the
 * price is current and not suppressed ("see price in bag"), and `priceLabel`
 * is sale/clearance only — "sale+regular" means some colours are full price,
 * a sale min/max pair is a range across colours/sizes. `yourPriceInfo` is
 * Kohl's coupon-applied "Your Price" (offer codes) and is never read.
 *
 * Hits carry colours but no per-size stock, so variants list colours only.
 * Product pages are `https://www.kohls.com/product/prd-<webID>/<slug>.jsp`.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "kohls";

const SITE = "https://www.kohls.com";
const API = "https://mapps.kohls.com/api/browse/v1/browse/catalog";
const PER_PAGE = 120;
const CAP = 1500;
/** A browser UA is load-bearing: the app's okhttp UA is refused by Akamai on this host. */
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keyword walks, in priority order. 15 requests, ~8 MB. */
export const WALKS: { keyword: string; label: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { keyword: "womens clothing", label: "Clothing", gender: "kadin", pages: 6 },
  { keyword: "womens shoes", label: "Shoes", gender: "kadin", pages: 3 },
  { keyword: "womens handbags", label: "Handbags", gender: "kadin", pages: 2 },
  { keyword: "juniors clothing", label: "Juniors", gender: "kadin", pages: 2 },
  { keyword: "womens jewelry", label: "Jewelry", gender: "kadin", pages: 1 },
  { keyword: "beauty", label: "Beauty", gender: null, pages: 1 },
];

export function searchUrl(keyword: string, page: number, limit = PER_PAGE): string {
  const q = new URLSearchParams({
    channel: "android",
    inStoreEnabled: "false",
    isDefaultStore: "false",
    shipToStore: "false",
    limit: String(limit),
    offset: String((page - 1) * limit + 1),
    sortID: "3", // Best Sellers
    keyword,
  });
  return `${API}?${q}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Shelf {sale, list} from a hit's price block, or null when it is not one clean reduction. */
export function shelfPrice(prices: any): { sale: number; list: number } | null {
  const p = Array.isArray(prices) ? prices[0] : null;
  if (!p || p.isSuppressed || p.isCurrentPrice === false) return null;
  if (p.priceLabel != null && !/^(sale|clearance)(\+(sale|clearance))?$/i.test(String(p.priceLabel))) return null;
  if (p.regularPrice?.maxPrice != null || p.salePrice?.maxPrice != null) return null;
  const list = num(p.regularPrice?.minPrice);
  const sale = num(p.salePrice?.minPrice);
  if (list == null || sale == null || !(sale > 0) || !(list > sale)) return null;
  return { sale, list };
}

/** Kohl's renditions take wid/hei; ask for a product-page size instead of the 180px tile. */
export const sized = (u: unknown): string | null => {
  if (typeof u !== "string" || !/^https?:\/\//.test(u)) return null;
  return `${u.split("?")[0]}?wid=1000&hei=1000&op_sharpen=1`;
};

/** The walk's section, unless the title plainly says otherwise. */
export function genderOf(title: string, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const women = /\bwomen['’]?s\b/i.test(title);
  if (/\b(boys?|girls?|kids?|baby|toddler|infant)['’]?s?\b/i.test(title) && !women) return "cocuk";
  if (/\bmen['’]?s\b/i.test(title) && !women) return "erkek"; // \b keeps "women" from matching
  return fallback;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Map one catalog hit. Pure; null unless it is genuinely reduced on the shelf. */
export function mapKohls(h: any, walk: { label: string; gender: ProductRecord["gender"] }): ProductRecord | null {
  const id = h?.webID != null ? String(h.webID) : "";
  const name = tidy(String(h?.productTitle ?? ""));
  const path = String(h?.seoURL ?? "");
  if (!id || !name || !path.startsWith("/product/")) return null;
  if (h?.prodType && h.prodType !== "product") return null; // collections/bundles price differently
  const price = shelfPrice(h?.prices);
  if (!price) return null;

  const main = sized(h?.image?.url);
  const photos = [main, sized(h?.altImageUrl)].filter((u): u is string => !!u);
  const colours = [...new Set(((h?.availableColr ?? []) as unknown[]).map((c) => tidy(String(c ?? ""))).filter(Boolean))];
  const colour = Array.isArray(h?.displayColor) && h.displayColor[0] ? tidy(String(h.displayColor[0])) : null;

  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: SITE + path,
    imageUrl: main,
    images: cleanGallery(photos, main),
    price: toMinor(price.sale),
    listPrice: toMinor(price.list),
    currency: "USD",
    inStock: h?.isAvailableforShip === true || h?.isAvailableforPickUp === true,
    category: walk.label,
    gender: genderOf(name, walk.gender),
    variants: colours.length ? { colors: colours, sizes: [] } : null,
    groupKey: null,
    colorName: colour,
  };
}

export async function listKohls(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  let hits = 0;
  const problems: string[] = [];
  for (const w of WALKS) {
    for (let page = 1; page <= w.pages; page++) {
      if (!first) await sleep(400);
      first = false;
      const data = await getJson<any>(searchUrl(w.keyword, page), { country, retries: 1, headers: HEADERS }).catch((e) => {
        problems.push(`${w.label} p${page}: ${String(e).slice(0, 120)}`);
        console.warn(`kohls: ${w.label} p${page} failed: ${String(e).slice(0, 120)}`);
        return null;
      });
      const items: any[] = Array.isArray(data?.payload?.products) ? data.payload.products : [];
      hits += items.length;
      if (data && !items.length) {
        const why = data?.error ? `error ${JSON.stringify(data.error).slice(0, 120)}` : `no products (keys: ${Object.keys(data?.payload ?? data ?? {}).slice(0, 8).join(",")})`;
        problems.push(`${w.label} p${page}: ${why}`);
        console.warn(`kohls: ${w.label} p${page}: ${why}`);
      }
      for (const h of items) {
        const r = mapKohls(h, w);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const total = Number(data?.count);
      if (items.length < PER_PAGE || (Number.isFinite(total) && page * PER_PAGE >= total)) break;
    }
  }
  if (hits === 0) throw new Error(`kohls: every search walk returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listKohls;
