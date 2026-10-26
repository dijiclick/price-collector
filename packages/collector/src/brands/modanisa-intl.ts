/**
 * Modanisa for the UAE and Saudi Arabia. Turkey stays in modanisa.ts; this is
 * the same search/listing BFF with the market in the storefront headers.
 *
 * Measured 2026-10-11: `X-Shipping-Country-Code: AE|SA` + `X-DisplayCurrency:
 * AED|SAR` + `Accept-Language: en` returns the English catalogue priced in the
 * market's currency ("68.26 AED", struck-through "227.50 AED"). The outlet list
 * is ~9k items there and, unlike Turkey's, every row carries a strikethrough,
 * so the walk stops at the cap (1,500 = 24 pages of 64). Product pages are
 * `/en/<slug>.html` (the slugs are the English ones; see sitemap_product_EN).
 *
 * Sizes come from the listing's `sizes`, which are the sizes on sale now, so
 * each is in stock; the Turkish detail pass (`product_variants.php`) is skipped
 * to stay inside the request budget.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { categoryPath, toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.modanisa.com/en";
const BFF = "https://searchlisting-web-bff.modanisa.com/products";
const SLUG = process.env.MODANISA_INTL_LIST ?? "outlet-12.list";
const PER_PAGE = 64;
const CAP = Number(process.env.MODANISA_INTL_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Math.ceil(CAP / PER_PAGE) + 2;
export const MODANISA_MARKETS: CountryCode[] = ["AE", "SA", "QA", "KW"];

export function intlHeaders(country: CountryCode): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Language": "en",
    "X-Shipping-Country-Code": country,
    "X-DisplayCurrency": COUNTRIES[country].currency,
    "X-Platform": "desktopWeb",
    "X-Multi-Warehouse-Enabled": "false",
  };
}

/** "1,227.50 AED" → 1227.5 (NaN when there is no number). */
export function enMoney(s: unknown): number {
  const m = String(s ?? "").match(/\d[\d,]*(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : NaN;
}

export function intlPrices(meta: any): { price: number; list: number | null } | null {
  const shelf = enMoney(meta?.campaignPriceValue) || enMoney(meta?.secondaryPrice?.display !== "hidden" ? meta?.secondaryPrice?.label : "");
  if (!Number.isFinite(shelf) || shelf <= 0) return null;
  const struck = meta?.primaryPrice?.display === "striped" ? enMoney(meta.primaryPrice.label) : NaN;
  return { price: shelf, list: Number.isFinite(struck) && struck > shelf ? struck : null };
}

function genderOf(categories: string[]): ProductRecord["gender"] {
  const c = categories.join(" | ");
  if (/\b(girls?|boys?|kids?|baby|children)\b/i.test(c)) return "cocuk";
  if (/\bmen'?s?\b/i.test(c)) return "erkek";
  return "kadin"; // a women's modest-fashion shop
}

export function mapIntlItem(it: any, country: CountryCode): ProductRecord | null {
  const money = intlPrices(it?.metadata);
  if (!it?.id || !it?.slug || !it?.name || !money) return null;
  const imgs: string[] = (it.images ?? []).filter((u: unknown) => typeof u === "string");
  const colour = Array.isArray(it.colors) && it.colors[0] ? String(it.colors[0]) : null;
  const sizes: SizeVariant[] = [...new Set<string>((it.sizes ?? []).map(String))].map((label) => ({
    label,
    availability: "in_stock" as const,
  }));
  return {
    brand: "modanisa",
    country,
    externalId: String(it.id),
    name: String(it.name).replace(/\s+/g, " ").trim(),
    url: `${SITE}/${it.slug}.html`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(money.price),
    listPrice: money.list != null ? toMinor(money.list) : null,
    currency: COUNTRIES[country].currency,
    inStock: true,
    category: categoryPath((it.categories ?? []).map(String)), // the shop's categories; the label is `maker`, as in modanisa.ts
    maker: it.brand ? String(it.brand).trim() || null : null,
    gender: genderOf((it.categories ?? []).map(String)),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    colorName: colour,
  };
}

export const brand = "modanisa";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  if (!MODANISA_MARKETS.includes(country)) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, 500));
    const url = `${BFF}?slug=${encodeURIComponent(SLUG)}&page=${page}&perPage=${PER_PAGE}`;
    const data = await getJson<any>(url, { headers: intlHeaders(country), country }).catch((e) => {
      if (page === 1) throw e;
      return null;
    });
    const items: any[] = data?.items ?? [];
    for (const it of items) {
      const r = mapIntlItem(it, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (items.length < PER_PAGE || !data?.metadata?.links?.next) break;
  }
  return [...byId.values()].slice(0, CAP);
}
