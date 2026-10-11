/**
 * Golden Scent (goldenscent.com) — the Saudi fragrance & beauty shop.
 * KSA is www.goldenscent.com/en, the UAE ae.goldenscent.com/en (the hreflang
 * table on the home page; `/sa-en`, `/ae-en` are 404s).
 *
 * Measured 2026-10-11: a Next.js App Router site that fetches its catalogue
 * server-side, so no browser-side API exists to call. The category page's RSC
 * flight data (the `self.__next_f.push` chunks in the HTML) carries each
 * product as a plain object: `priceValue`, `oldPriceValue`, `discountPercent`,
 * `currency`, `options.choices[{label, inStock}]` (the ml sizes), `urlKey`.
 * `best-sellers/best-sellers-on-sale` is the site's all-sale list (~1,550 in
 * KSA); pages are `/page/N` (20 a page; `?page=N` redirects to page 1).
 *
 * Pages are ~2 MB of HTML each, so the walk is capped at MAX_PAGES (40 pages
 * = 800 products) to stay inside the request budget.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const GOLDENSCENT_SITES: Partial<Record<CountryCode, string>> = {
  SA: "https://www.goldenscent.com/en",
  AE: "https://ae.goldenscent.com/en",
};
const LIST = "c/best-sellers/best-sellers-on-sale";
const MAX_PAGES = Number(process.env.GOLDENSCENT_MAX_PAGES ?? 40);
const CAP = 1500;

/** Join and unescape the RSC flight chunks embedded in a server-rendered page. */
export function flightText(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      out += JSON.parse(`"${m[1]}"`);
    } catch {
      /* a malformed chunk only loses its own products */
    }
  }
  return out;
}

/** The JSON array (or object) that starts at `start` in `s`, bracket-matched. */
function sliceJson(s: string, start: number): string | null {
  const open = s[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open || c === "[" || c === "{") depth++;
    else if (c === close || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The listing's product objects and page count out of the flight text.
 *
 * RSC de-duplicates: a product already serialised as a card's `"product":{…}`
 * prop appears in the `"products":[…]` array only as a `"$2d8:props:product"`
 * reference. So both shapes are read and merged by sku.
 */
export function parseListing(flight: string): { products: any[]; totalPages: number } {
  const bySku = new Map<string, any>();
  const keep = (p: any) => {
    if (p && typeof p === "object" && p.sku && p.urlKey && !bySku.has(p.sku)) bySku.set(p.sku, p);
  };
  for (const m of flight.matchAll(/"products":\[/g)) {
    const raw = sliceJson(flight, m.index! + '"products":'.length);
    try {
      if (raw) for (const p of JSON.parse(raw) as any[]) keep(p);
    } catch {
      /* keep what parsed */
    }
  }
  for (const m of flight.matchAll(/"product":\{"/g)) {
    const raw = sliceJson(flight, m.index! + '"product":'.length);
    try {
      if (raw) keep(JSON.parse(raw));
    } catch {
      /* a card we cannot read */
    }
  }
  const tp = flight.match(/"totalPages":(\d+)/);
  return { products: [...bySku.values()], totalPages: tp ? Number(tp[1]) : 0 };
}

function genderOf(p: any): ProductRecord["gender"] {
  const t = `${p?.description ?? ""} ${p?.name ?? ""}`;
  if (/\b(kids?|girls?|boys?|baby)\b/i.test(t)) return "cocuk";
  const women = /\b(women|her)\b/i.test(t);
  const men = /\b(men|him)\b/i.test(t);
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return null;
}

/** Map one listing product. Pure. */
export function mapGoldenScent(p: any, country: CountryCode): ProductRecord | null {
  const site = GOLDENSCENT_SITES[country];
  const price = Number(p?.priceValue);
  const old = Number(p?.oldPriceValue);
  if (!site || !p?.sku || !p?.name || !p?.urlKey || !(price > 0)) return null;
  if (p.currency && p.currency !== COUNTRIES[country].currency) return null;
  const sizes: SizeVariant[] = (p?.options?.choices ?? [])
    .filter((c: any) => c?.label)
    .map((c: any) => ({ label: String(c.label).trim(), availability: c.inStock ? "in_stock" : "out_of_stock" }));
  const img = typeof p.imageUrl === "string" ? p.imageUrl : null;
  const brand = p.brand ? String(p.brand).trim() : "";
  const name = String(p.name).replace(/\s+/g, " ").trim();
  return {
    brand: "goldenscent",
    country,
    externalId: String(p.sku),
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    url: `${site}/p/${p.urlKey}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: COUNTRIES[country].currency,
    inStock: p.isOutOfStock !== true && p.stockStatus !== "OUT_OF_STOCK",
    category: p.productType ? String(p.productType) : null,
    gender: genderOf(p),
    variants: sizes.length ? { colors: [], sizes } : null,
  };
}

export const brand = "goldenscent";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  const site = GOLDENSCENT_SITES[country];
  if (!site) return [];
  const byId = new Map<string, ProductRecord>();
  let total = 1;
  for (let page = 1; page <= Math.min(total, MAX_PAGES); page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, 700));
    const url = page === 1 ? `${site}/${LIST}` : `${site}/${LIST}/page/${page}`;
    const html = await getText(url, { country, headers: { Accept: "text/html" } }).catch((e) => {
      if (page === 1) throw e;
      return "";
    });
    const { products, totalPages } = parseListing(flightText(html));
    if (page === 1) total = totalPages || 1;
    if (products.length === 0 && page === 1) break;
    for (const p of products) {
      const r = mapGoldenScent(p, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
