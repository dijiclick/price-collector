/**
 * Kohl's by url (`www.kohls.com/product/prd-<webID>/<slug>.jsp`). The product
 * page and the app's product endpoint are Akamai-walled for datacenter egress,
 * but the app's catalog search (`mapps.kohls.com/api/browse/v1/browse/catalog`)
 * answers a browser UA from the US (GitHub probe 39135448486, 2026-10-18), and
 * a search for the web id returns exactly that product. Same feed and price
 * rules as the collector (packages/collector/src/brands/kohls.ts): the shelf
 * sale price when it is one clean value, else the single regular price;
 * Kohl's coupon "Your Price" is never read. Geo-walled from Turkey.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.kohls.com";
const API = "https://mapps.kohls.com/api/browse/v1/browse/catalog";

/** The web id out of a kohls.com product url, or null. */
export function kohlsIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)kohls\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/product\/prd-(\d+)/i);
  if (m) return m[1];
  const q = u.searchParams.get("prdPV") ?? u.searchParams.get("productId");
  return q && /^\d+$/.test(q) ? q : null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** One catalog hit → LiveProduct. Pure. */
export function mapKohlsHit(h: any): LiveProduct | null {
  const id = h?.webID != null ? String(h.webID) : "";
  const name = String(h?.productTitle ?? "").replace(/\s+/g, " ").trim();
  if (!id || !name) return null;
  const p = Array.isArray(h?.prices) ? h.prices[0] : null;
  const reg = num(p?.regularPrice?.minPrice);
  if (reg == null || reg <= 0) return null;
  const sale = num(p?.salePrice?.minPrice);
  const clean =
    sale != null && sale > 0 && sale < reg && !p?.isSuppressed &&
    p?.regularPrice?.maxPrice == null && p?.salePrice?.maxPrice == null &&
    (p?.priceLabel == null || /^(sale|clearance)(\+(sale|clearance))?$/i.test(String(p.priceLabel)));
  // A sale RANGE across colours/sizes is no clean discount claim, but its top
  // end is still what every variant costs at most — better than the regular price.
  const rangeTop = !clean ? num(p?.salePrice?.maxPrice) : null;
  const current = clean ? sale! : rangeTop != null && rangeTop > 0 && rangeTop < reg && !p?.isSuppressed ? rangeTop : reg;
  const img = typeof h?.image?.url === "string" ? `${h.image.url.split("?")[0]}?wid=1000&hei=1000&op_sharpen=1` : null;
  const title = name;
  const women = /\bwomen['’]?s\b/i.test(title);
  const gender = /\b(boys?|girls?|kids?|baby|toddler)\b/i.test(title) && !women ? "cocuk"
    : /\bmen['’]?s\b/i.test(title) && !women ? "erkek"
    : women || /\bjuniors['’]?\b/i.test(title) ? "kadin" : null;
  return {
    brand: "kohls",
    externalId: id,
    name,
    url: SITE + (typeof h?.seoURL === "string" && h.seoURL.startsWith("/") ? h.seoURL : `/product/prd-${id}/`),
    imageUrl: img,
    price: toMinor(current),
    listPrice: clean ? toMinor(reg) : null,
    inStock: h?.isAvailableforShip === true || h?.isAvailableforPickUp === true,
    category: null,
    type: null,
    gender,
    colorName: Array.isArray(h?.displayColor) && h.displayColor[0] ? String(h.displayColor[0]) : null,
    country: "US",
    currency: "USD",
  };
}

export async function kohlsUrl(url: string): Promise<LiveProduct | null> {
  const id = kohlsIdFromUrl(url);
  if (!id) return null;
  const q = new URLSearchParams({ channel: "android", inStoreEnabled: "false", isDefaultStore: "false", shipToStore: "false", limit: "5", offset: "1", keyword: id });
  const body = await json<any>(`${API}?${q}`, { Accept: "application/json", "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, countryFor("kohls", "us"));
  const hit = (body?.payload?.products ?? []).find((h: any) => String(h?.webID) === id);
  return hit ? mapKohlsHit(hit) : null;
}
