/**
 * Single-product lookup for SFCC SFRA storefronts through their own
 * `Product-Variation` controller, which answers JSON (`product.price.sales /
 * .list`, availability, colour/size attributes, images).
 *
 * Asked with an app User-Agent: Ann Taylor, LOFT and Lane Bryant run
 * PerimeterX in the controller layer and redirect a browser UA from a
 * datacenter IP to `/px?…`, but pass `okhttp/4.12.0` — the same route the
 * collector's grids use (packages/collector/src/brands/_okgrid.ts). Measured
 * 2026-10-18 on anntaylor.com, loft.com, lanebryant.com, birkenstock.com.
 *
 * Ann Inc. prints a second, lower "PRICE AS MARKED" price (an everyone
 * pricebook, `promo.promoMaster.sales`, `isXCCPrice`) — the price the shopper
 * pays, and what the collector stores; it wins when it is below the sale price.
 */
import type { LiveProduct } from "../live-lookup";
import { countryFor, json, toMinor } from "../live-http";

export const APP_UA = "okhttp/4.12.0";

export interface SfccShop {
  brand: string;
  /** Storefront origin, e.g. `https://www.anntaylor.com`. */
  web: string;
  /** `Sites-<id>-Site/<locale>` path part, e.g. `Sites-AnnTaylor-Site/default`. */
  site: string;
  gender?: LiveProduct["gender"];
}

export const variationUrl = (shop: SfccShop, pid: string, colour?: string | null) =>
  `${shop.web}/on/demandware.store/${shop.site}/Product-Variation?pid=${encodeURIComponent(pid)}` +
  (colour ? `&dwvar_${encodeURIComponent(pid)}_color=${encodeURIComponent(colour)}` : "");

/** The first photo url in a Product-Variation `images` block, whatever its shape. */
function firstImage(images: any, raw: string): string | null {
  for (const k of ["hi-res", "large", "Main", "plp", "medium", "small"]) {
    const v = images?.[k];
    const u = Array.isArray(v) ? v[0]?.url ?? v[0]?.absURL : v?.url;
    if (typeof u === "string" && /^https?:\/\//.test(u)) return u;
  }
  return raw.match(/https:\/\/[^"\s]+\/dw\/image\/v2\/[^"\s?]+\.jpg/)?.[0] ?? null;
}

/** Map a `Product-Variation` body. `raw` is the same body as text (an image fallback). Pure. */
export function mapSfccVariation(shop: SfccShop, body: any, url: string, externalId: string, raw = "", useMarked = true): LiveProduct | null {
  const p = body?.product;
  if (!p?.id || !p?.productName) return null;
  const sales = Number(p.price?.sales?.value ?? p.price?.min?.sales?.value);
  if (!Number.isFinite(sales) || sales <= 0) return null;
  const marked = useMarked && p.promo?.promoMaster?.isXCCPrice ? Number(p.promo.promoMaster.sales?.value) : NaN;
  const price = Number.isFinite(marked) && marked > 0 && marked < sales ? marked : sales;
  const list = Number(p.price?.list?.value ?? p.price?.max?.list?.value);
  const colour = (p.variationAttributes ?? [])
    .find((a: any) => a?.id === "color")
    ?.values?.find((v: any) => v?.selected)?.displayValue;
  return {
    brand: shop.brand,
    externalId,
    name: String(p.productName).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: firstImage(p.images, raw),
    price: toMinor(price),
    listPrice: Number.isFinite(list) && list > price ? toMinor(list) : null,
    inStock: p.available !== false,
    category: null,
    type: null,
    gender: shop.gender ?? null,
    colorName: typeof colour === "string" && colour.trim() ? colour.trim() : null,
    country: "US",
    currency: "USD",
  };
}

/**
 * `useMarked: false` keeps the plain sale price. Ann Inc. grouped styles
 * (`grp_<pid>_<colour>.html`) show no "price as marked" on the grid tile the
 * collector reads, so the lookup must not either — or the row would flip
 * between the two prices every sweep.
 */
export async function sfccVariationLookup(shop: SfccShop, pid: string, colour: string | null, url: string, externalId = pid, useMarked = true): Promise<LiveProduct | null> {
  const body = await json<any>(
    variationUrl(shop, pid, colour),
    { "User-Agent": APP_UA, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
    countryFor(shop.brand, "US"),
  );
  return body ? mapSfccVariation(shop, body, url, externalId, JSON.stringify(body), useMarked) : null;
}

/** `dwvar_<pid>_color=<code>` from a pasted url, or null. */
export function colourParam(u: URL, pid: string): string | null {
  return u.searchParams.get(`dwvar_${pid}_color`) || null;
}
