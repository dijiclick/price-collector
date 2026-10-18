/**
 * Express (US) — the storefront's own GraphQL, `getUnbxdCategory` (2026-10-18).
 *
 * express.com is Akamai Bot Manager: pages answer a browser UA from a GitHub
 * runner with a 403, and a bare POST to `/graphql` is refused too. The same
 * POST passes when it carries what the site's own Apollo client sends — an app
 * User-Agent (`okhttp/…`), `origin`/`referer` on express.com and the
 * `x-exp-rvn-*` routing headers. No cookies, no sensor data. Verified from a
 * runner (probe 39136646957).
 *
 * The listing is Unbxd behind that resolver. The clearance trees are the
 * markdowns: `cat890004` Clearance (women, ~860) and `cat890006` Men's
 * Clearance (~560); `rows` is capped at 100 by the server.
 *
 * Prices are display strings ("$64.00", "$12.97-$19.97"). One record per
 * product: the colour with the lowest SINGLE sale price whose own list price is
 * higher — a range is never read as a was/now pair. Marketplace (third-party)
 * listings are skipped. Colour prices differ inside one product (final-sale
 * colours at $19.97, the rest at the regular promo price) — the chosen colour
 * is named in `colorName`.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "express";

const SITE = "https://www.express.com";
const GQL = `${SITE}/graphql`;
const IMG = "https://images.express.com/is/image/expressfashion";
const ROWS = 100;
const CAP = 1500;
const MAX_REQ = 20;

export const CATEGORIES: [id: string, gender: ProductRecord["gender"]][] = [
  ["cat890004", "kadin"],
  ["cat890006", "erkek"],
];

/** What the site's Apollo client sends; without these Akamai refuses the POST. */
export const EXPRESS_HEADERS: Record<string, string> = {
  "User-Agent": "okhttp/4.12.0",
  Accept: "*/*",
  "Content-Type": "application/json",
  "apollographql-client-name": "main-raven-apollo-client",
  "x-exp-request-id": "146b777c-0afa-43db-9745-666955f587df",
  "x-exp-rvn-cacheable": "true",
  "x-exp-rvn-query-classification": "getUnbxdCategory",
  "x-exp-rvn-source": "app_express.com",
  origin: SITE,
  referer: `${SITE}/sale`,
};

const QUERY = `query CategoryQuery($categoryId: String, $start: Int!, $rows: Int, $filter: String, $sort: String) {
  getUnbxdCategory(categoryId: $categoryId, start: $start, rows: $rows, filter: $filter, sort: $sort) {
    categoryName
    pagination { totalProductCount }
    products {
      productId name listPrice salePrice productURL productImage gender marketplaceProduct
      colors { color colorProductId skuUpc displaySalePrice displayListPrice imageSet }
    }
  }
}`;

export function categoryBody(categoryId: string, start: number, rows = ROWS): string {
  return JSON.stringify({ operationName: "CategoryQuery", query: QUERY, variables: { categoryId, start, rows, filter: "", sort: "" } });
}

/** "$64.00" → 64; "$12.97-$19.97" (a range) → null. */
export function singlePrice(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s || /\d\s*-\s*\$?\d/.test(s)) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const imageUrl = (id: string) => `${IMG}/${id}?cache=on&wid=960&fmt=jpeg&qlt=85,1&resmode=sharp2&op_usm=1,1,5,0`;

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Clearance listings name a product `<id>F` (the final-sale alias); its page,
 * its url and the product resolver all use the plain `<id>`. Store the plain
 * one so a pasted link and the stored row are the same product.
 */
export const baseId = (raw: unknown) => String(raw ?? "").trim().replace(/F$/, "");

export function mapExpressProduct(p: any, fallbackGender: ProductRecord["gender"]): ProductRecord | null {
  const id = baseId(p?.productId);
  const name = String(p?.name ?? "").trim();
  if (!id || !name || p?.marketplaceProduct) return null;
  const colours: any[] = Array.isArray(p?.colors) ? p.colors : [];
  const pairs = colours
    .map((c) => ({ c, sale: singlePrice(c?.displaySalePrice), list: singlePrice(c?.displayListPrice) }))
    .filter((x) => x.sale != null && x.list != null && x.sale < x.list)
    .sort((a, b) => a.sale! - b.sale!);
  let sale: number | null;
  let list: number | null;
  let colour: any = null;
  if (pairs.length) {
    ({ sale, list } = pairs[0]);
    colour = pairs[0].c;
  } else {
    sale = singlePrice(p?.salePrice);
    list = singlePrice(p?.listPrice);
  }
  if (sale == null || list == null || sale >= list) return null;
  const shots: string[] = Array.isArray(colour?.imageSet) ? colour.imageSet.filter((s: unknown) => typeof s === "string" && /_[fa]\d{3}$/.test(s as string)) : [];
  const gallery = shots.map(imageUrl);
  const hero = gallery[0] ?? (typeof p?.productImage === "string" ? p.productImage.replace(/wid=\d+/, "wid=960") : null);
  const g = String(p?.gender ?? "").toLowerCase();
  const path = String(p?.productURL ?? "");
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: path.startsWith("http") ? path : `${SITE}${path}`,
    imageUrl: hero,
    images: cleanGallery(gallery, hero),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true,
    category: null,
    gender: g === "women" ? "kadin" : g === "men" ? "erkek" : fallbackGender,
    variants: colours.length ? { colors: [...new Set(colours.map((c) => titleCase(String(c?.color ?? ""))).filter(Boolean))], sizes: [] } : null,
    groupKey: null,
    colorName: colour?.color ? titleCase(String(colour.color)) : null,
  };
}

export async function listProducts(country: CountryCode = "US"): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let req = 0;
  for (const [cat, gender] of CATEGORIES) {
    for (let start = 0; req < MAX_REQ && byId.size < CAP; start += ROWS) {
      if (req++) await new Promise((r) => setTimeout(r, 700));
      const d = await getJson<any>(GQL, { country, method: "POST", headers: EXPRESS_HEADERS, body: categoryBody(cat, start) });
      const c = d?.data?.getUnbxdCategory;
      const rows: any[] = c?.products ?? [];
      for (const p of rows) {
        const r = mapExpressProduct(p, gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (!rows.length || start + ROWS >= (c?.pagination?.totalProductCount ?? 0)) break;
    }
  }
  return [...byId.values()].slice(0, CAP);
}
