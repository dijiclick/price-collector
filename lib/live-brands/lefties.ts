/**
 * Lefties by url (`lefties.com/tr/…-c1030267944p752749319.html`), Turkey only.
 *
 * The `p{id}` is the product id the collector stores. `productsArray` answers
 * it without Akamai's challenge (the category/detail endpoints 403 or 404), and
 * the store/catalog come from the store list — catalog ids rotate by season —
 * with the current Turkish pair as the fallback. A bundle id resolves to its
 * inner product, which is the id the collector keys on.
 */
import type { LiveProduct } from "../live-lookup";
import { classifyType } from "../productTypes";
import { UA, countryFor, json } from "../live-http";

const DOMAIN = "www.lefties.com";
const TR_FALLBACK = { storeId: 94009021, catalogId: 90009064 };
const HEADERS = {
  Accept: "application/json",
  "User-Agent": UA,
  Referer: `https://${DOMAIN}/tr/`,
};

/** `…p752749319.html` on a Turkish Lefties url → "752749319". Pure. */
export function leftiesIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)lefties\.com$/i.test(u.hostname)) return null;
  // Other markets price in other currencies; the brand is collected for Turkey only.
  if (!/^\/tr(\/|$)/i.test(u.pathname)) return null;
  return u.pathname.match(/p(\d{6,})\.html$/i)?.[1] ?? null;
}

let market: { at: number; storeId: number; catalogId: number } | null = null;
async function trMarket(): Promise<{ storeId: number; catalogId: number }> {
  if (market && Date.now() - market.at < 6 * 3600_000) return market;
  const list = await json<any>(
    `https://${DOMAIN}/itxrest/2/catalog/store?languageId=-1&appId=1&brandId=9`,
    HEADERS,
    countryFor("lefties"),
  );
  const stores: any[] = (list?.stores ?? []).filter((s: any) => s?.countryCode === "TR");
  const store = stores.find((s) => s.isOpenForSale !== false && (s.type ?? 1) === 1) ?? stores[0];
  const catalog = store?.catalogs?.find((c: any) => c.type === 1);
  if (!store || !catalog) return TR_FALLBACK; // not cached: retry the list next time
  market = { at: Date.now(), storeId: store.id, catalogId: catalog.id };
  return market;
}

function gender(section: unknown, url: string): string | null {
  let path = url;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { /* keep raw */ }
  const seg = path.toLowerCase().match(/^\/tr\/(?:en\/)?([^/]+)\/[^/]+\//)?.[1] ?? "";
  if (/^(çocuk|kids|bebek|baby)$/.test(seg)) return "cocuk";
  if (/^(kadın|woman|women)$/.test(seg)) return "kadin";
  if (/^(erkek|man|men)$/.test(seg)) return "erkek";
  if (seg === "home") return null;
  const s = String(section ?? "").toUpperCase();
  if (/\b(BOYS?|GIRLS?|BABY|KIDS?)\b/.test(s)) return "cocuk";
  if (/\bWOMEN\b/.test(s)) return "kadin";
  if (/\bMEN\b/.test(s)) return "erkek";
  return null;
}

/** Map one productsArray entry for the asked id. Pure. */
export function mapLefties(p: any, id: string, url: string): LiveProduct | null {
  const real = p?.bundleProductSummaries?.[0] ?? p;
  if (!real?.id || (String(real.id) !== id && String(p?.id) !== id)) return null;
  const color = real.detail?.colors?.[0];
  const name = String(real.name ?? "").trim();
  if (!color || !name) return null;
  let price = Infinity;
  let listPrice: number | null = null;
  for (const s of color.sizes ?? []) {
    const v = Number(s?.price); // already minor units
    if (!Number.isFinite(v) || v <= 0 || v >= price) continue;
    price = v;
    const o = s?.oldPrice == null ? NaN : Number(s.oldPrice);
    listPrice = Number.isFinite(o) && o > v ? o : null;
  }
  if (!Number.isFinite(price)) return null;
  const sizes: any[] = color.sizes ?? [];
  const inStock = p.isBuyable !== false && (sizes.length === 0 || sizes.some((s) => {
    const vis = String(s?.visibilityValue ?? "").toUpperCase();
    return vis ? vis === "SHOW" || /RUNNING|LOW|FEW/.test(vis) : s?.isBuyable !== false;
  }));
  // First model shot (-A1…) of this colour, else its first still.
  const urls: string[] = [];
  for (const x of real.detail?.xmedia ?? []) {
    if (x?.colorCode != null && String(x.colorCode) !== String(color.id)) continue;
    for (const it of x?.xmediaItems ?? []) for (const m of it?.medias ?? []) {
      // About half the media carry a relative `url`; the absolute one is in deliveryUrl.
      const u = [m?.url, m?.extraInfo?.deliveryUrl].find((x) => typeof x === "string" && /^https?:/.test(x));
      if (u && !/\.(m3u8|mp4)(\?|$)/i.test(u)) urls.push(u);
    }
  }
  const image = urls.find((u) => /-A\d+\/[^/]+\.jpe?g/i.test(u)) ?? urls[0] ?? null;
  const category = String(p.subFamilyName || p.familyName || "").replace(/^[A-Z0-9]{2,4}:/, "").trim() || null;
  return {
    brand: "lefties",
    externalId: String(real.id),
    name,
    url: url.split(/[?#]/)[0],
    imageUrl: image,
    price,
    listPrice,
    inStock,
    category,
    type: classifyType(category, name),
    gender: gender(p.sectionNameEN ?? real.sectionNameEN, url),
    colorName: color.name ?? null,
    country: "TR",
    currency: "TRY",
  };
}

export async function leftiesUrl(url: string): Promise<LiveProduct | null> {
  const id = leftiesIdFromUrl(url);
  if (!id) return null;
  const m = await trMarket();
  const res = await json<any>(
    `https://${DOMAIN}/itxrest/3/catalog/store/${m.storeId}/${m.catalogId}/productsArray?productIds=${id}&languageId=-43&appId=1`,
    HEADERS,
    countryFor("lefties"),
  );
  for (const p of res?.products ?? []) {
    const hit = mapLefties(p, id, url);
    if (hit) return hit;
  }
  return null;
}
