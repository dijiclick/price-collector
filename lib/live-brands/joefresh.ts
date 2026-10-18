/**
 * Joe Fresh by url (`joefresh.com/ca/<slug>/p/<SKU>`). The storefront's own
 * BFF answers one product by SKU — `/ca/api/shared/getSingleProduct`, the call
 * the site's quick-view makes — in the same shape as the sale grid the
 * collector reads (packages/collector/src/brands/joefresh.ts), so the id is the
 * collector's: `colorVariantCode` (`<style>_<colour>`). Prices are dollar
 * strings; `sizes[].disabled` is a size sold out online.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json } from "../live-http";

const SITE = "https://www.joefresh.com/ca";

export function joefreshSkuFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)joefresh\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/p\/([A-Z0-9]+_[A-Z]{2})\/?$/i);
  return m ? m[1].toUpperCase() : null;
}

const cents = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return n > 0 ? n : null;
};

/** Map a getSingleProduct body. Pure. */
export function mapJoeFreshProduct(body: any, sku: string, pageUrl?: string): LiveProduct | null {
  const list: any[] = Array.isArray(body?.products) ? body.products : [];
  const p =
    list.find((x) => x?.code === sku || (Array.isArray(x?.sizes) && x.sizes.some((s: any) => s?.liam === sku))) ?? list[0];
  const id = String(p?.colorVariantCode ?? "").trim();
  const name = String(p?.name ?? "").trim();
  if (!id || !name) return null;
  const regular = cents(p.regularPrice);
  const sale = cents(p.salePrice);
  const price = sale ?? regular;
  if (price == null) return null;
  const sizes: any[] = Array.isArray(p.sizes) ? p.sizes : [];
  const online = p?.availability?.isDisabledOnline !== true;
  const path = typeof p.url === "string" && p.url.startsWith("/") ? p.url : null;
  return {
    brand: "joefresh",
    externalId: id,
    name,
    url: path ? `${SITE}${path}` : pageUrl ?? `${SITE}/p/${sku}`,
    imageUrl: typeof p?.images?.thumbnailDesktop === "string" ? p.images.thumbnailDesktop : null,
    price,
    listPrice: regular != null && regular > price ? regular : null,
    inStock: online && (sizes.length ? sizes.some((s) => s && !s.disabled) : true),
    category: null,
    type: null,
    gender: null,
    colorName: typeof p.colorCode === "string" && p.colorCode.trim() ? p.colorCode.trim() : null,
    country: "CA",
    currency: "CAD",
  };
}

export async function joefreshUrl(url: string): Promise<LiveProduct | null> {
  const sku = joefreshSkuFromUrl(url);
  if (!sku) return null;
  const body = await json<any>(
    `${SITE}/api/shared/getSingleProduct?productCodes=${encodeURIComponent(sku)}`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("joefresh", "CA"),
  );
  const u = new URL(url);
  return body ? mapJoeFreshProduct(body, sku, `https://www.joefresh.com${u.pathname}`) : null;
}
