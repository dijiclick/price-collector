/**
 * Bath & Body Works US (bathandbodyworks.com) by url: `/p/<slug>-<id>`. The site
 * is PerimeterX-walled, so the lookup asks the Constructor.io index the
 * collector reads (packages/collector/src/brands/bathandbodyworks-us.ts) for
 * that item id — `browse/items?ids=` answers from any egress. Same price rule:
 * the sale price only while a no-code product promotion is live.
 * Only the US host; the TR (Ticimax) and Gulf (Alshaya) shops are other sites.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const KEY = "key_KHDGYQMK0OhdRsv2";
const SITE = "https://www.bathandbodyworks.com";

export function bbwIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, "") !== "bathandbodyworks.com") return null;
  return u.pathname.match(/^\/p\/[^/]*?-?(\d{6,})\/?$/)?.[1] ?? null;
}

function livePromo(promos: any[] | undefined, now: number): boolean {
  return (promos ?? []).some((p) => {
    if (p?.promotionClass !== "PRODUCT" || p?.basedOnCoupon !== false || p?.active === false) return false;
    const s = Date.parse(String(p.startDate ?? ""));
    const e = Date.parse(String(p.endDate ?? ""));
    return (!Number.isFinite(s) || s <= now) && (!Number.isFinite(e) || now < e);
  });
}

/** Map a Constructor `browse/items` body. Pure. */
export function mapBbwItems(body: any, url: string, now = Date.now()): LiveProduct | null {
  const res = body?.response?.results?.[0];
  const d = res?.data;
  const shelf = Number(d?.price);
  if (!d?.id || !Number.isFinite(shelf) || shelf <= 0) return null;
  const list = Number(d.c_listPrice ?? shelf);
  const sale = Number(d.c_salePrice);
  const onSale = Number.isFinite(sale) && sale > 0 && sale < shelf && livePromo(d.promotions, now);
  const price = onSale ? sale : shelf;
  const img = typeof d.image_url === "string" && d.image_url.startsWith("/on/demandware.static/")
    ? `${SITE}/dw/image/v2/BBDL_PRD${d.image_url}?sw=900&sh=900&sm=fit`
    : null;
  return {
    brand: "bathandbodyworks",
    externalId: String(d.id),
    name: String(res.value ?? d.c_productName ?? "").replace(/&trade;/g, "™").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(),
    url,
    imageUrl: img,
    price: toMinor(price),
    listPrice: Number.isFinite(list) && list > price ? toMinor(list) : null,
    inStock: Number(d.inventory?.ats) > 0 && d.c_forceSoldOut !== true,
    category: typeof d.c_productType === "string" ? d.c_productType : null,
    type: null,
    gender: null,
    colorName: typeof d.c_fragranceName === "string" ? d.c_fragranceName : null,
    country: "US",
    currency: "USD",
  };
}

export async function bathandbodyworksUrl(url: string): Promise<LiveProduct | null> {
  const id = bbwIdFromUrl(url);
  if (!id) return null;
  const body = await json<any>(
    `https://ac.cnstrc.com/browse/items?key=${KEY}&ids=${id}&c=ciojs-client-2.0`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor("bathandbodyworks", "US"),
  );
  return body ? mapBbwItems(body, url.split("#")[0]) : null;
}
