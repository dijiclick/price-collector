/**
 * Sephora Australia (sephora.au, formerly sephora.com.au). A third Sephora
 * platform, separate from Turkey (SFCC, sephora.ts) and the US/Canada catalog
 * (sephora-intl.ts): Sephora Asia's JSON:API, which serves every Sephora
 * Southeast-Asia/ANZ store from `api.sephora.sg`. The country is chosen by the
 * `X-Site-Country` header (`AU` → AUD prices, sephora.au URLs).
 *
 * The websites and the API sit behind Akamai, which refuses browser
 * User-Agents and lets the mobile app's HTTP client through (`okhttp`).
 * Verified from a GitHub runner, probe run 38134856152, no proxy.
 *
 * The sale page is `filter[others]=on_sale` (read from the web app's bundle:
 * the "sale" landing page adds exactly that filter). ~560 products, 100 per page
 * with their variants (~4.4 MB a page, so ~6 requests / ~26 MB a run). Prices
 * are integer cents. Each variant carries its own price, original price,
 * inventory count and UPC, so the on-sale shades/sizes become the size list
 * (restock alerts per shade) and the UPCs become barcodes.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "sephora";

const API = "https://api.sephora.sg/api/v2.6/products";
export const SEPHORA_ASIA_HEADERS = (country: CountryCode): Record<string, string> => ({
  "User-Agent": "okhttp/4.12.0",
  Accept: "application/json",
  "Accept-Language": `en-${country}`,
  "X-Site-Country": country,
});
/** Markets this API serves for us: AU, and since 2026-10-21 Singapore and Hong Kong. */
export const SEPHORA_ASIA_MARKETS: CountryCode[] = ["AU", "SG", "HK"];
const PAGE = 100;
const MAX_PAGES = 12;
const PAUSE_MS = 800;
const CAP = 1500;
const LOW_STOCK = 3;

export function pageUrl(page: number): string {
  const q = new URLSearchParams({
    "page[size]": String(PAGE),
    "page[number]": String(page),
    include: "variants,brand",
    "filter[others]": "on_sale",
  });
  return `${API}?${q}`;
}

function availability(v: any): SizeVariant["availability"] {
  if (v?.["sold-out"] === true || v?.available === false) return "out_of_stock";
  const q = Number(v?.inventory);
  return Number.isFinite(q) && q > 0 && q <= LOW_STOCK ? "low_on_stock" : "in_stock";
}

/** Map one product with its included variants/brand. Pure; null unless reduced. */
export function mapSephoraAsia(p: any, included: Map<string, any>, country: CountryCode): ProductRecord | null {
  const a = p?.attributes;
  if (!p?.id || !a?.name || !a?.["web-url"]) return null;
  const variants: any[] = ((p?.relationships?.variants?.data ?? []) as any[])
    .map((r) => included.get(`variants:${r.id}`)?.attributes)
    .filter(Boolean);
  const reduced = variants
    .filter((v) => Number(v?.price) > 0 && Number(v?.price) < Number(v?.["original-price"]))
    .map((v) => ({ v, avail: availability(v) }));

  let price: number;
  let was: number;
  if (reduced.length) {
    const pick = [...reduced].sort(
      (x, y) =>
        Number(x.avail === "out_of_stock") - Number(y.avail === "out_of_stock") || Number(x.v.price) - Number(y.v.price),
    )[0];
    price = Number(pick.v.price);
    was = Number(pick.v["original-price"]);
  } else {
    price = Number(a.price);
    was = Number(a["original-price"]);
  }
  if (!(Number.isFinite(price) && price > 0 && Number.isFinite(was) && price < was)) return null;

  const brandId = p?.relationships?.brand?.data?.id;
  const label = String(included.get(`brands:${brandId}`)?.attributes?.name ?? variants[0]?.["brand-name"] ?? "").trim();
  const title = String(a.name).trim();
  const name = label && !title.toLowerCase().startsWith(label.toLowerCase()) ? `${label} ${title}` : title;

  // Single-variant products are named "Default": no size list for those.
  const sizes: SizeVariant[] =
    variants.length > 1
      ? reduced.map((x) => ({ label: String(x.v.name ?? "").trim(), availability: x.avail })).filter((s) => s.label)
      : [];
  const imgs: string[] = (a["image-urls"] ?? []).filter((u: unknown): u is string => typeof u === "string");
  const upcs = [...new Set(variants.map((v) => String(v?.upc ?? "").trim()).filter((u) => /^\d{8,14}$/.test(u)))];
  const kind = (a["option-type-categories"] ?? [])[0];

  return {
    brand,
    country,
    externalId: String(p.id),
    name,
    url: String(a["web-url"]),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price,
    listPrice: was,
    currency: COUNTRIES[country].currency,
    inStock: a["sold-out"] !== true && (variants.length === 0 || variants.some((v) => availability(v) !== "out_of_stock")),
    barcodes: upcs.length ? upcs : null,
    category: null,
    gender: null,
    variants: sizes.length ? { colors: kind === "shade" ? sizes.map((s) => s.label) : [], sizes } : null,
  };
}

export async function listSephoraAsia(country: CountryCode): Promise<ProductRecord[]> {
  // SG (sephora.sg) and HK (sephora.hk) are the same API, added 2026-10-21; prices are cents there too.
  if (!SEPHORA_ASIA_MARKETS.includes(country)) return [];
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let n = 1; n <= Math.min(pages, MAX_PAGES); n++) {
    if (n > 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
    const d = await getJson<any>(pageUrl(n), { headers: SEPHORA_ASIA_HEADERS(country), country });
    if (!Array.isArray(d?.data)) throw new Error(`sephora/${country}: malformed page ${n}`);
    pages = Number(d?.meta?.["total-pages"] ?? 1);
    const included = new Map<string, any>((d.included ?? []).map((i: any) => [`${i.type}:${i.id}`, i]));
    for (const p of d.data) {
      const r = mapSephoraAsia(p, included, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listSephoraAsia;
