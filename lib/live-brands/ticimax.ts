/**
 * Small Turkish Ticimax shops by url (2026-10-23): Pumps Up
 * (`pumpsup.com/tracy-beyaz-deri-terlik-beyaz-deri-2107`). Same route as
 * victoriassecret.ts: the product page is read once for
 * `productDetailModel.productId`, then the listing XHR filtered to that id
 * (`StrProductIds`) answers the card the collector maps
 * (packages/collector/src/brands/_ticimax.ts) — cart price charged, shelf
 * price struck, price net of VAT plus `…KDV`, id = `productId`.
 *
 * Direct egress only: Turkish shops never go through the proxy (owner rule).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, toMinor } from "../live-http";

export interface TicimaxLiveShop {
  brand: string;
  site: string;
  host: string;
  /** Section when the name does not say. */
  gender: "kadin" | "erkek" | null;
}

export const TICIMAX_LIVE_SHOPS: Record<string, TicimaxLiveShop> = {
  pumpsup: { brand: "pumpsup", site: "https://www.pumpsup.com", host: "pumpsup.com", gender: "kadin" },
};

/** The shop and path of a pasted product url, or null if it is not one of ours. */
export function ticimaxPathFromUrl(shop: TicimaxLiveShop, url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== shop.host && !host.endsWith(`.${shop.host}`)) return null;
  // Ticimax product paths are one segment: `/<slug>-<id or stock code>`.
  if (!/^\/[^/]+-[A-Za-z0-9]+\/?$/.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, "");
}

/** `var productDetailModel = {"productId":2107,…` → 2107. */
export function ticimaxProductIdFromHtml(html: string): number | null {
  const m = html.match(/productDetailModel\s*=\s*\{\s*"productId"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

const gross = (p: any, field: string) => Number(p?.[field]) + (Number(p?.[`${field}KDV`]) || 0);

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

/** Map one GetProductList card exactly as the collector does. Pure. */
export function mapTicimaxCard(shop: TicimaxLiveShop, p: any): LiveProduct | null {
  const shelf = gross(p, "productSellPrice");
  const cart = gross(p, "productCartPrice");
  if (!p?.productId || !p?.name || !Number.isFinite(shelf) || shelf <= 0) return null;
  const price = Number.isFinite(cart) && cart > 0 ? Math.min(cart, shelf) : shelf;
  const img = [p.imageThumbPath, p.imageLoadingPath].find((u) => typeof u === "string" && u);
  const name = String(p.name).trim();
  const t = fold(`${name} ${p.category ?? ""}`);
  return {
    brand: shop.brand,
    externalId: String(p.productId),
    name,
    url: `${shop.site}${p.url ?? p.defaultUrl ?? ""}`,
    imageUrl: img ? String(img).replace("/UrunResimleri/thumb/", "/UrunResimleri/buyuk/") : null,
    price: toMinor(price),
    listPrice: shelf - price > 0.005 ? toMinor(shelf) : null,
    inStock: p.inStock === true && Number(p.totalStockAmount ?? 1) > 0,
    category: typeof p.category === "string" && p.category.trim() ? p.category.trim() : null,
    type: null,
    gender: /\b(cocuk|bebek|kiz|genc)\b/.test(t) ? "cocuk" : /\bkadin\b/.test(t) ? "kadin" : /\berkek\b/.test(t) ? "erkek" : shop.gender,
    colorName: null,
    country: "TR",
    currency: "TRY",
  };
}

export function ticimaxCardUrl(site: string, productId: number): string {
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
  return `${site}/api/product/GetProductList?${q}`;
}

async function get(url: string, accept: string): Promise<Response | null> {
  const host = new URL(url).host;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${host} refused with HTTP ${r.status} (direct egress)`);
      return null;
    }
    return r;
  } catch (err) {
    console.warn(`live-lookup: ${host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function ticimaxUrl(shop: TicimaxLiveShop, url: string): Promise<LiveProduct | null> {
  const path = ticimaxPathFromUrl(shop, url);
  if (!path) return null;
  const page = await get(`${shop.site}${path}`, "text/html");
  const id = page ? ticimaxProductIdFromHtml(await page.text()) : null;
  if (!id) return null;
  const res = await get(ticimaxCardUrl(shop.site, id), "application/json");
  const body: any = res ? await res.json().catch(() => null) : null;
  const card = (body?.products ?? []).find((p: any) => Number(p?.productId) === id);
  return mapTicimaxCard(shop, card);
}

/** One resolver per shop, keyed by brand slug, for EXTRA_RESOLVERS. */
export const TICIMAX_RESOLVERS: Record<string, (url: string) => Promise<LiveProduct | null>> = Object.fromEntries(
  Object.values(TICIMAX_LIVE_SHOPS).map((s) => [s.brand, (url: string) => ticimaxUrl(s, url)]),
);
