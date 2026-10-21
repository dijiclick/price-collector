/**
 * Shopbop (shopbop.com — US, and Canada priced in CAD) — multi-designer store.
 *
 * The site's own public API (`environmentConfig.shopbopClientApiDomain`):
 *
 *   GET https://api.shopbop.com/public/categories/<folderId>/products
 *       ?lang=en-US&currency=USD|CAD&limit=100&offset=N
 *   headers Client-Id: Shopbop-UI, Client-Version: 1.0.0
 *
 * answers JSON with no key. The sale tree (folder 13594, women; 19188, men) is
 * read per section. Each product has `retailPrice` (the full price Shopbop
 * charged, struck through on the site) and `lowPrice`/`highPrice`; a row is
 * kept only when low == high (one sale price across colours) and below the
 * retail price. `currency=CAD` returns Shopbop's own Canadian prices (CA$, the
 * same figures shoppers in Canada see). `designerName` is the maker.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "shopbop";

const API = "https://api.shopbop.com/public/categories";
const SITE = "https://www.shopbop.com";
const IMG = "https://m.media-amazon.com/images/G/01/Shopbop/p";
const LIMIT = 100;
const CAP = 1500;
const PAUSE_MS = 700;
const HEADERS = { "Client-Id": "Shopbop-UI", "Client-Version": "1.0.0", Accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SHOPBOP_CURRENCY: Partial<Record<CountryCode, string>> = { US: "USD", CA: "CAD" };

/** Sale folders (ids from shopbop.com's own sale tree), with section gender and pages of 100. */
export const SHOPBOP_SLICES: [folder: string, gender: ProductRecord["gender"], category: string | null, pages: number][] = [
  ["15381", "kadin", null, 8], // Women > Sale > Clothing
  ["15539", "kadin", "Shoes", 2], // Shoes
  ["15355", "kadin", "Bags", 2], // Bags
  ["15304", "kadin", null, 2], // Jewelry & Accessories
  ["70293", null, null, 1], // Beauty
  ["19188", "erkek", null, 3], // Men's sale
];

export const pageUrl = (folder: string, offset: number, currency: string) =>
  `${API}/${folder}/products?lang=en-US&currency=${currency}&limit=${LIMIT}&offset=${offset}`;

/** "$1,148.50" / "CA$393.88" → 1148.5; anything else → null. */
export function amount(v: unknown): number | null {
  const m = /^\s*(?:CA)?\$\s*([\d,]+(?:\.\d+)?)\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Map one listing entry (`{ product, colorSin }`). Pure; null unless one sale price below retail. */
export function mapShopbop(entry: any, country: CountryCode, gender: ProductRecord["gender"], category: string | null): ProductRecord | null {
  const p = entry?.product;
  const currency = SHOPBOP_CURRENCY[country];
  if (!p?.productSin || !p?.shortDescription || !p?.productDetailUrl || !currency) return null;
  const list = amount(p.retailPrice?.price);
  const lo = amount(p.lowPrice?.price);
  const hi = amount(p.highPrice?.price);
  if (list == null || lo == null || hi == null || lo !== hi || !(list > lo)) return null;
  if (p.giftCertificate) return null;

  const colors: any[] = Array.isArray(p.colors) ? p.colors : [];
  const colour = colors.find((c) => c?.colorSin === (entry.colorSin ?? p.defaultColorSin)) ?? colors[0];
  const photos = (Array.isArray(colour?.images) ? colour.images : [])
    .map((im: any) => (typeof im?.src === "string" ? `${IMG}${im.src}` : null))
    .filter(Boolean) as string[];
  const maker = typeof p.designerName === "string" && p.designerName.trim() ? p.designerName.trim() : null;
  const title = String(p.shortDescription).trim();
  const kind = typeof p.productType === "string" && p.productType ? p.productType : category;
  const g: ProductRecord["gender"] = p.gender === "MENS" ? "erkek" : p.gender === "WOMENS" ? "kadin" : gender;

  return {
    brand,
    country,
    externalId: colour?.colorSin ? `${p.productSin}-${colour.colorSin}` : String(p.productSin),
    name: maker && !title.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url: SITE + String(p.productDetailUrl),
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(lo),
    listPrice: toMinor(list),
    currency,
    inStock: (colour?.inStock ?? p.inStock) !== false,
    category: kind ?? null,
    maker,
    gender: g,
    variants: null,
    groupKey: colors.length > 1 ? `shopbop-${p.productSin}` : null,
    colorName: typeof colour?.name === "string" ? colour.name : null,
  };
}

export async function listShopbop(country: CountryCode): Promise<ProductRecord[]> {
  const currency = SHOPBOP_CURRENCY[country];
  if (!currency) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const [folder, gender, category, pages] of SHOPBOP_SLICES) {
    for (let page = 0; page < pages; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(pageUrl(folder, page * LIMIT, currency), { country, headers: HEADERS, retries: 1, timeoutMs: 30_000 });
      const rows: any[] = Array.isArray(d?.products) ? d.products : [];
      if (!rows.length && page === 0) throw new Error(`shopbop/${country}: sale folder ${folder} returned no products`);
      for (const e of rows) {
        const r = mapShopbop(e, country, gender, category);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (rows.length < LIMIT || (page + 1) * LIMIT >= Number(d?.totalResults ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listShopbop;
