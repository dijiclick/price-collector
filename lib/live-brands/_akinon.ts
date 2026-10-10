/**
 * Single-product lookup for Akinon storefronts (Lacoste, Pierre Cardin,
 * Marks & Spencer). Any product path answers JSON with `?format=json`.
 *
 * The id must equal the collector's (packages/collector/src/brands/_akinon.ts):
 * `<base_code>-<colour attribute>`. Not `product.pk` — a pasted url names one
 * SIZE, whose pk differs from the size the listing happened to show.
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

export interface AkinonLiveShop {
  brand: string;
  /** Origin, e.g. `https://www.lacoste.com.tr`. */
  site: string;
  /** Hostname without `www.`, guards against other shops' urls. */
  host: string;
  sizeKey: string;
  colorKey: string;
  colorNameAttrs: string[];
  categoryAttrs: string[];
  genderAttrs: string[];
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").toLowerCase();

function genderOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = fold(text);
  if (/cocuk|bebek|kiz|genc/.test(t)) return "cocuk";
  if (/kadin/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return null;
}

function attr(p: any, key: string): string | null {
  const kw = p?.attributes_kwargs?.[key];
  const v = (kw && typeof kw === "object" && kw.label) || p?.attributes?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Same rule as the collector's `akinonId`. */
export function akinonLiveId(p: any, colorKey: string): string | null {
  const base = typeof p?.base_code === "string" ? p.base_code.trim() : "";
  const colour = p?.attributes?.[colorKey];
  if (base) return typeof colour === "string" && colour.trim() ? `${base}-${colour.trim()}` : base;
  return p?.pk != null ? String(p.pk) : null;
}

/** Map an Akinon PDP body (`{product, variants, in_stock}`). Pure. */
export function mapAkinonDetail(shop: AkinonLiveShop, res: any, path: string): LiveProduct | null {
  const p = res?.product;
  const id = akinonLiveId(p, shop.colorKey);
  const price = parseFloat(p?.price);
  if (!id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p.retail_price);
  const groups: any[] = res.variants ?? [];
  const opts = (key: string): any[] => groups.find((g) => g?.attribute_key === key)?.options ?? [];
  const sizes = opts(shop.sizeKey);
  const colourOpt = opts(shop.colorKey).find((o) => o?.is_selected) ?? null;
  const img = [...(p.productimage_set ?? [])]
    .filter((im: any) => im && (im.status == null || im.status === "active"))
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
  return {
    brand: shop.brand,
    externalId: id,
    name: String(p.name).trim(),
    // A size SKU without its own SEO slug answers `/product/<pk>/`; the pasted
    // path is the better link to keep.
    url: `${shop.site}${typeof p.absolute_url === "string" && !/^\/product\/\d+\/?$/.test(p.absolute_url) ? p.absolute_url : path}`,
    imageUrl: img?.image ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    inStock: sizes.length > 0 ? sizes.some((o) => o?.in_stock === true) : res.in_stock !== false && p.in_stock !== false,
    category: shop.categoryAttrs.map((a) => attr(p, a)).find(Boolean) ?? null,
    type: null,
    gender: genderOf(shop.genderAttrs.map((a) => attr(p, a)).find(Boolean)) ?? genderOf(p.absolute_url ?? path),
    colorName: shop.colorNameAttrs.map((a) => attr(p, a)).find(Boolean) ?? (colourOpt?.label ? String(colourOpt.label) : null),
    country: "TR",
    currency: "TRY",
  };
}

export async function akinonUrl(shop: AkinonLiveShop, url: string): Promise<LiveProduct | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().replace(/^www\./, "").endsWith(shop.host)) return null;
  if (u.pathname === "/" || u.pathname === "" || /^\/(list|search|arama)\/?$/.test(u.pathname)) return null;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  const res = await json<any>(
    `${shop.site}${path}?format=json`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor(shop.brand),
  );
  return mapAkinonDetail(shop, res, path);
}
