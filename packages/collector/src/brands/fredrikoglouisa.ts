/**
 * Fredrik & Louisa (Norwegian beauty chain: perfume, skincare, make-up, hair),
 * 2026-10-11. Not Shopify — WooCommerce, and its public Store API answers a
 * plain GET: `/wp-json/wc/store/v1/products?on_sale=true&stock_status=instock`.
 * No key, no cookie, no proxy.
 *
 * Prices come as minor-unit strings already (`prices.price` "29300" with
 * `currency_minor_unit: 2`, NOK). ~2,700 "on sale" rows are in stock, but
 * ~40% are not reduced at the parent level (the sale sits on one variation)
 * and are dropped, so pages run until the cap: at most 30 requests.
 *
 * Shades and sizes are variations whose stock lives behind one call each, so
 * `variants` stays null. Gender only where the shop says so (Dame/Herre
 * categories, mostly fragrance); everything else is unisex beauty → null.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "fredrikoglouisa";
const ORIGIN = "https://fredrikoglouisa.no";
const PER_PAGE = 100;
const CAP = 1500;
const MAX_PAGES = Number(process.env.FREDRIKOGLOUISA_MAX_PAGES ?? 30);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s.replace(/&#0?38;|&amp;/g, "&").replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&quot;/g, '"').replace(/&#039;/g, "'");

/** Store API prices are strings in minor units; normalise to 2 decimals. */
function minor(v: unknown, unit: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 10 ** (2 - unit));
}

export function mapFredrikOgLouisa(p: any, country: CountryCode = "NO"): ProductRecord | null {
  const pr = p?.prices;
  if (!p?.id || !p?.name || !p?.permalink || !pr) return null;
  if (pr.currency_code && pr.currency_code !== COUNTRIES[country].currency) return null;
  const unit = Number(pr.currency_minor_unit ?? 2);
  const price = minor(pr.sale_price || pr.price, unit);
  const regular = minor(pr.regular_price, unit);
  if (!(price > 0)) return null;
  const imgs: string[] = (p.images ?? []).map((i: any) => i?.src).filter((u: unknown) => typeof u === "string");
  const cats: string[] = (p.categories ?? []).map((c: any) => String(c?.name ?? ""));
  const gtm = p?.extensions?.gtm4wp?.item ?? {};
  const maker = typeof gtm.item_brand === "string" ? decode(gtm.item_brand).trim() : "";
  const name = decode(String(p.name)).trim();
  return {
    brand,
    country,
    externalId: String(p.id),
    name: maker && !name.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${name}` : name,
    url: String(p.permalink),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price,
    listPrice: regular > price ? regular : null,
    currency: COUNTRIES[country].currency,
    inStock: p.is_in_stock === true,
    category: typeof gtm.item_category === "string" && gtm.item_category ? decode(gtm.item_category) : cats[cats.length - 1] || null,
    gender: cats.includes("Herre") && !cats.includes("Dame") ? "erkek" : cats.includes("Dame") && !cats.includes("Herre") ? "kadin" : null,
    variants: null,
  };
}

export function saleUrl(page: number): string {
  return `${ORIGIN}/wp-json/wc/store/v1/products?on_sale=true&stock_status=instock&per_page=${PER_PAGE}&page=${page}`;
}

export async function listFredrikOgLouisa(country: CountryCode = "NO"): Promise<ProductRecord[]> {
  if (country !== "NO") return [];
  const byId = new Map<string, ProductRecord>();
  for (let n = 1; n <= MAX_PAGES && byId.size < CAP; n++) {
    if (n > 1) await sleep(700);
    let rows: any[];
    try {
      rows = await getJson<any[]>(saleUrl(n), { country });
    } catch (err) {
      if (n === 1) throw err;
      break; // past the last page WooCommerce answers 400
    }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const p of rows) {
      const r = mapFredrikOgLouisa(p, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < PER_PAGE) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listFredrikOgLouisa;
