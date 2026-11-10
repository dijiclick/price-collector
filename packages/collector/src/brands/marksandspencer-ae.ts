/**
 * Marks & Spencer UAE (marksandspencer.ae, Al-Futtaim) — a different shop from
 * marksandspencer.com (marksandspencer-intl.ts): its own catalogue and AED
 * prices on Kibo Commerce, searched through Algolia. Measured 2026-11-10:
 *
 * - The site's HTML publishes the Algolia app and search-only key
 *   (`algoliaCredentials`: JAE17AD3EU). Index `mns_ae_prod_fashion_product`
 *   holds one record per size (41,961), grouped by `parentID` (`distinct`).
 *   Only the UAE has indices on this app (no SA/KW/QA).
 * - `onSale:true` is the site's own sale flag: 695 products (2,212 size rows),
 *   each with `productPrice` (was) and `productSalePrice` (now) in AED.
 * - A search answers at most 1,000 hits. One distinct query returns every
 *   reduced product; the per-size rows are then read in `discountPercentage`
 *   slices that each stay under 1,000, and attached as sizes. Every indexed
 *   size row is in stock (`inStock` is true on all of them), so listed sizes
 *   are sellable sizes.
 * - Product pages are `/en/fashion/products/<slug>/<parentID>` (the site's own
 *   link builder; the slug is not checked).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = "JAE17AD3EU";
const KEY = "ac51444806ae56b9fb1b3f5bcdddd039";
const INDEX = "mns_ae_prod_fashion_product";
const SITE = "https://www.marksandspencer.ae";
const CAP = 1500;
const FIELDS = "parentID,objectID,ProductTitle.EN,productPrice,productSalePrice,imageURL,gender.EN,productSize.EN,colour.EN,inStock,productType.EN,discountPercentage";
/** `discountPercentage` slices for the per-size walk; each held < 1,000 rows on 2026-11-10. */
export const MNS_AE_SLICES: [number, number][] = [[1, 29], [30, 39], [40, 49], [50, 50], [51, 54], [55, 59], [60, 100]];

const en = (v: any): string => String((v && typeof v === "object" ? v.EN : v) ?? "").trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "p";

function genderOf(g: string): ProductRecord["gender"] {
  if (/girl|boy|kid|baby/i.test(g)) return "cocuk";
  if (/^womens?$/i.test(g)) return "kadin";
  if (/^mens?$/i.test(g)) return "erkek";
  return null;
}

/** "A21020102 WOMENS DRESSES" → "Dresses". */
export function typeOf(raw: string): string | null {
  const t = raw.replace(/^[A-Z]?\d+\s+/, "").replace(/^[WMK]\s+/, "").replace(/\b(WOMENS|MENS|GIRLS|BOYS|KIDS|LADIES)\b/gi, "").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null;
}

/** Map one distinct hit (a product). Pure; null unless it is reduced. */
export function mapMnsAe(h: any): ProductRecord | null {
  const id = String(h?.parentID ?? "").trim();
  const name = en(h?.ProductTitle);
  const price = Number(h?.productSalePrice);
  const list = Number(h?.productPrice);
  if (!id || !name || !(price > 0) || !(list > price)) return null;
  const imgs: string[] = (Array.isArray(h.imageURL) ? h.imageURL : [])
    .filter((u: unknown): u is string => typeof u === "string" && u.length > 4)
    .map((u: string) => (u.startsWith("//") ? `https:${u}` : u));
  const colour = en(h.colour);
  return {
    brand: "marksandspencer",
    country: "AE",
    externalId: id,
    name,
    url: `${SITE}/en/fashion/products/${slug(name)}/${id}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "AED",
    inStock: h.inStock !== false,
    category: typeOf(en(h.productType)),
    gender: genderOf(en(h.gender)),
    variants: null,
    groupKey: null,
    colorName: colour ? colour.charAt(0) + colour.slice(1).toLowerCase() : null,
  };
}

export function mnsAeBody(filters: string, distinct: boolean, page = 0): string {
  const p = new URLSearchParams({ hitsPerPage: "1000", page: String(page), filters, attributesToRetrieve: FIELDS, attributesToHighlight: "" });
  if (!distinct) p.set("distinct", "false");
  return JSON.stringify({ params: p.toString() });
}

async function query(body: string): Promise<any[]> {
  const d = await getJson<any>(`https://${APP}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
    country: "AE",
    method: "POST",
    body,
    retries: 2,
    headers: { "x-algolia-application-id": APP, "x-algolia-api-key": KEY, "content-type": "application/json" },
  });
  return Array.isArray(d?.hits) ? d.hits : [];
}

/** Attach the size rows to their products. Pure. */
export function withSizes(products: ProductRecord[], sizeRows: any[]): ProductRecord[] {
  const by = new Map<string, Map<string, SizeVariant>>();
  for (const h of sizeRows) {
    const id = String(h?.parentID ?? "");
    const label = en(h?.productSize);
    if (!id || !label || /^(one size|na|n\/a)$/i.test(label)) continue;
    const sizes = by.get(id) ?? new Map<string, SizeVariant>();
    if (!sizes.has(label)) sizes.set(label, { label, availability: h.inStock === false ? "out_of_stock" : "in_stock" });
    by.set(id, sizes);
  }
  return products.map((r) => {
    const sizes = by.get(r.externalId);
    return sizes?.size ? { ...r, variants: { colors: r.colorName ? [r.colorName] : [], sizes: [...sizes.values()] }, sizesInStockOnly: true } : r;
  });
}

export async function listMarksAe(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AE") return [];
  const hits = await query(mnsAeBody("onSale:true", true));
  if (!hits.length) throw new Error("marksandspencer/AE: the sale query returned no products");
  const byId = new Map<string, ProductRecord>();
  for (const h of hits) {
    const r = mapMnsAe(h);
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  const sizeRows: any[] = [];
  for (const [lo, hi] of MNS_AE_SLICES) {
    sizeRows.push(...(await query(mnsAeBody(`onSale:true AND discountPercentage:${lo} TO ${hi}`, false)).catch(() => [])));
  }
  const all = withSizes([...byId.values()], sizeRows);
  // Women first: the feed's audience.
  const rank = (r: ProductRecord) => (r.gender === "kadin" ? 0 : r.gender === "erkek" ? 2 : r.gender === "cocuk" ? 3 : 1);
  return all.sort((a, b) => rank(a) - rank(b)).slice(0, CAP);
}
