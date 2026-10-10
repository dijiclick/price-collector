/**
 * Single-product lookup for the İpekyol Group storefronts (İpekyol, Twist).
 * A product url is `/urun/<routePath>`; the page is server-rendered Next.js,
 * so its `__NEXT_DATA__` already holds the product (`pageProps.data.response.product`)
 * — one request, no buildId needed. The id is the product `id`, as the
 * collector stores (packages/collector/src/brands/_ipekyolgroup.ts).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, dispatcher, toMinor } from "../live-http";

export interface GroupLiveShop {
  brand: string;
  site: string;
  /** Hostname without `www.`. */
  host: string;
  imageBase: string;
}

export function groupRouteFromUrl(url: string, host: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().replace(/^www\./, "").endsWith(host)) return null;
  return u.pathname.match(/^\/urun\/([^/?#]+)\/?$/)?.[1] ?? null;
}

/** The JSON inside `<script id="__NEXT_DATA__">`, or null. */
export function nextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Map a PDP `product`. Pure. */
export function mapGroupDetail(shop: GroupLiveShop, p: any): LiveProduct | null {
  const base = Number(p?.basePrice);
  const sale = [p?.salesPrice, p?.discountPrice].map(Number).filter((x) => Number.isFinite(x) && x > 0);
  const price = sale.length ? Math.min(...sale) : base;
  if (!p?.id || !p?.name || !p?.routePath || !Number.isFinite(price) || price <= 0) return null;
  const doc = [...(p.documents ?? [])]
    .filter((d: any) => d?.documentType === "Image" && typeof d.filePath === "string")
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
  const stock = Object.values(p.stocksByBarcode ?? {}).map(Number);
  const colour =
    (p.attributes ?? []).find((a: any) => a?.attribute?.integrationCode === "color")?.attributeValues?.[0]?.value ??
    (typeof p.shortName === "string" && p.shortName.trim() ? p.shortName.trim() : null);
  return {
    brand: shop.brand,
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: `${shop.site}/urun/${p.routePath}`,
    imageUrl: doc ? `${shop.imageBase}${doc.filePath.startsWith("/") ? "" : "/"}${doc.filePath}` : null,
    price: toMinor(price),
    listPrice: Number.isFinite(base) && base > price ? toMinor(base) : null,
    inStock: stock.length ? stock.some((n) => n > 0) : true,
    category: (p.categories ?? []).find((c: any) => c?.name && !/outlet/i.test(c.name))?.name ?? p.categories?.[0]?.name ?? null,
    type: null,
    gender: "kadin",
    colorName: colour,
    country: "TR",
    currency: "TRY",
  };
}

export async function groupUrl(shop: GroupLiveShop, url: string): Promise<LiveProduct | null> {
  const route = groupRouteFromUrl(url, shop.host);
  if (!route) return null;
  const host = new URL(shop.site).host;
  let html: string;
  try {
    const r = await fetch(`${shop.site}/urun/${route}`, {
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "tr-TR,tr;q=0.9" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // @ts-expect-error undici's dispatcher is accepted by Node's fetch
      dispatcher: dispatcher(countryFor(shop.brand)),
    });
    if (!r.ok) {
      console.warn(`live-lookup: ${host} refused with HTTP ${r.status}`);
      return null;
    }
    html = await r.text();
  } catch (err) {
    console.warn(`live-lookup: ${host} unreachable — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return mapGroupDetail(shop, nextData(html)?.props?.pageProps?.data?.response?.product);
}
