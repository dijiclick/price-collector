/**
 * Victoria's Secret TR by url (`victoriassecret.com.tr/victoria-s-secret-…-VS26431516`).
 * Ticimax: the url's tail is a variant's stock code, not the card id, so the
 * product page is read once for `productDetailModel.productId`, and the
 * listing XHR filtered to that id (`StrProductIds`) answers the same card the
 * collector maps — price net of VAT plus `…KDV`, strike price, stock.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, json, toMinor } from "../live-http";

const SITE = "https://www.victoriassecret.com.tr";

export function vsPathFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("victoriassecret.com.tr")) return null;
  if (!/^\/[^/]+-[A-Z]{2}\d{5,}\/?$/i.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, "");
}

/** `var productDetailModel = {"productId":13849,…` → 13849. */
export function vsProductIdFromHtml(html: string): number | null {
  const m = html.match(/productDetailModel\s*=\s*\{\s*"productId"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

const gross = (net: unknown, vat: unknown) => Number(net) + (Number(vat) || 0);

/** Map one GetProductList card. Pure. */
export function mapVsCard(p: any): LiveProduct | null {
  // Cart price is the reduced price, sell price the strikethrough (see the
  // collector's victoriassecret.ts, 2026-10-11).
  const shelf = gross(p?.productSellPrice, p?.productSellPriceKDV);
  const cart = gross(p?.productCartPrice, p?.productCartPriceKDV);
  const price = Number.isFinite(cart) && cart > 0 && Number.isFinite(shelf) ? Math.min(cart, shelf) : shelf;
  if (!p?.productId || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const original = Math.max(shelf, gross(p.productPriceOriginal, p.productPriceOriginalKDV) || 0);
  const img = typeof p.imageThumbPath === "string" ? p.imageThumbPath.replace("/UrunResimleri/thumb/", "/UrunResimleri/buyuk/") : null;
  return {
    brand: "victoriassecret",
    externalId: String(p.productId),
    name: String(p.name).trim(),
    url: `${SITE}${p.url ?? p.defaultUrl ?? ""}`,
    imageUrl: img,
    price: toMinor(price),
    listPrice: Number.isFinite(original) && original - price > 0.005 ? toMinor(original) : null,
    inStock: p.inStock === true && Number(p.totalStockAmount ?? 1) > 0,
    category: p.category ?? null,
    type: null,
    gender: /erkek|\bhim\b/i.test(`${p.name} ${p.category ?? ""}`) ? "erkek" : "kadin",
    colorName: null,
    country: "TR",
    currency: "TRY",
  };
}

function cardUrl(productId: number): string {
  const filter = {
    CategoryIdList: [], BrandIdList: [], SupplierIdList: [], TagIdList: [], TagId: -1, FilterObject: [],
    MinStockAmount: -1, IsShowcaseProduct: -1, IsOpportunityProduct: -1, FastShipping: -1, IsNewProduct: -1,
    IsDiscountedProduct: -1, IsShippingFree: -1, IsProductCombine: -1, MinPrice: 0, MaxPrice: 0,
    SearchKeyword: "", StrProductIds: String(productId), IsSimilarProduct: false, RelatedProductId: 0,
    ProductKeyword: "", PageContentId: 0, StrProductIDNotEqual: "", IsVariantList: -1, IsVideoProduct: -1,
    ShowBlokVideo: -1, VideoSetting: { ShowProductVideo: 0, AutoPlayVideo: -1 }, ShowList: 1,
    VisibleImageCount: 6, ShowCounterProduct: -1, ImageSliderActive: false, ProductListPageId: 0,
    ShowGiftHintActive: false,
  };
  const q = new URLSearchParams({
    c: "1",
    FilterJson: JSON.stringify(filter),
    PagingJson: JSON.stringify({ PageItemCount: 1, PageNumber: 1, OrderBy: "KATEGORISIRA", OrderDirection: "ASC" }),
    CreateFilter: "false", TransitionOrder: "0", PageType: "1", PageId: "0",
  });
  return `${SITE}/api/product/GetProductList?${q}`;
}

export async function victoriassecretUrl(url: string): Promise<LiveProduct | null> {
  const path = vsPathFromUrl(url);
  if (!path) return null;
  const country = countryFor("victoriassecret");
  let html: string;
  try {
    const r = await fetch(`${SITE}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(country),
    });
    if (!r.ok) {
      console.warn(`live-lookup: www.victoriassecret.com.tr refused with HTTP ${r.status}`);
      return null;
    }
    html = await r.text();
  } catch (err) {
    console.warn(`live-lookup: www.victoriassecret.com.tr unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const id = vsProductIdFromHtml(html);
  if (!id) return null;
  const body = await json<any>(cardUrl(id), { Accept: "application/json", "User-Agent": UA }, country);
  const card = (body?.products ?? []).find((p: any) => Number(p?.productId) === id);
  return mapVsCard(card);
}
