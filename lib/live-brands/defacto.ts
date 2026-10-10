/**
 * DeFacto by url (`defacto.com.tr/<seo-name>-<ProductVariantIndex>`). The
 * product page inlines `DataLayer:{…}` — the same object the listing cards
 * carry (Price / DiscountedPrice / CampaignDiscountedPrice, colour, category)
 * — and `PRODUCT_DETAIL_SIZE_DATA=[…]` with per-size stock. Akamai refuses
 * Node's default fetch, hence the shared browser-shaped HTTP/2 request.
 *
 * Price rule matches the collector (packages/collector/src/brands/defacto.ts):
 * the automatic "Sepette" basket price is what is paid; the original is the
 * was-price.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor } from "../live-http";
import { classifyType } from "../productTypes";
import { browserText, decodeEntities, extractJsonAfter } from "./_browser";

const SITE = "https://www.defacto.com.tr";

export function defactoIndex(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname.match(/-(\d{6,})\/?$/)?.[1] ?? null;
  } catch { return null; }
}

/** Pure: a fetched product page → LiveProduct (exported for tests). */
export function parseDefactoPage(html: string, url: string): LiveProduct | null {
  const d = extractJsonAfter(html, "DataLayer:") as any;
  const idx = d?.ProductVariantIndex;
  const orig = Number(d?.Price);
  const shelf = Number(d?.DiscountedPrice) > 0 ? Number(d.DiscountedPrice) : orig;
  if (!idx || !d?.Name || !Number.isFinite(shelf) || shelf <= 0) return null;
  const camp = Number(d.CampaignDiscountedPrice ?? d.CampaignBadge?.DiscountPrice);
  const price = Number.isFinite(camp) && camp > 0 && camp < shelf ? camp : shelf;
  const was = Math.max(Number.isFinite(orig) ? orig : 0, shelf);

  const at = html.indexOf("PRODUCT_DETAIL_SIZE_DATA=[");
  const sizes = (at < 0 ? null : extractJsonAfter(html, "PRODUCT_DETAIL_SIZE_DATA=", at)) as any[] | null;
  const ldAvail = /schema\.org\/InStock/.test(html);
  const inStock = Array.isArray(sizes) && sizes.length
    ? sizes.some((s) => Number(s?.StockQuantity) > 0)
    : Number(d.Stock) > 0 || ldAvail;

  // schema.org lists the gallery at a thumbnail width (`/7/`); ask the CDN for 768.
  const file = d.PictureName ?? html.match(/"image":\["https:\/\/dfcdn\.defacto\.com\.tr\/\d+\/([^"]+)"/)?.[1];
  const pic = file ? `https://dfcdn.defacto.com.tr/768/${file}` : null;
  const sub = String(d.SubDivision ?? "").toLowerCase();
  const gender = /girl|boy|kid|baby/.test(sub) ? "cocuk" : sub === "woman" ? "kadin" : sub === "man" ? "erkek" : null;
  const name = decodeEntities(String(d.Name)).trim();
  const category = d.CategoryName ? decodeEntities(String(d.CategoryName)) : null;
  return {
    brand: "defacto",
    externalId: String(idx),
    name,
    url,
    imageUrl: pic,
    price: Math.round(price * 100),
    listPrice: was > price ? Math.round(was * 100) : null,
    inStock,
    category,
    type: classifyType(category, name, "defacto"),
    gender,
    colorName: d.ColorName ? decodeEntities(String(d.ColorName)) : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function defactoUrl(url: string): Promise<LiveProduct | null> {
  if (!defactoIndex(url)) return null;
  const clean = `${SITE}${new URL(url).pathname}`;
  const html = await browserText(clean, { country: countryFor("defacto"), order: "proxy-first" });
  return html ? parseDefactoPage(html, clean) : null;
}
