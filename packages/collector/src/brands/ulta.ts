/**
 * Ulta Beauty (US) — the sale grid at /promotion/sale, read through the same
 * GraphQL GET endpoint (`/dxl/graphql`, Apollo) ulta.com's own pages hydrate
 * from. No key or cookie; the only requirement is Apollo's CSRF guard, which a
 * non-empty `apollo-require-preflight` header satisfies. One request per grid
 * page of 64 cards; measured 2026-10-11: 1,258 sale products = 20 pages.
 *
 * Prices: the card's display strings are RANGES whenever the product has
 * several sizes ("$26.00 - $67.00" / "$13.00 - $33.50"), but its analytics
 * block (`dataCapture…Tealium.product_price/product_sale_price`) carries the
 * single price pair of the sku the card shows. That pair is used; a card with
 * no usable pair is dropped rather than guessed from a range.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const SITE = "https://www.ulta.com";
const SALE_PATH = `${SITE}/promotion/sale`;
const PER_PAGE = 64;
const MAX_PAGES = Number(process.env.ULTA_MAX_PAGES ?? 24);
const PAUSE_MS = Number(process.env.ULTA_PAUSE_MS ?? 900);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAGE_QUERY = `query Page($stagingHost: String, $previewOptions: JSON, $moduleParams: JSON, $url: JSON) {
  Page: Page(stagingHost: $stagingHost, previewOptions: $previewOptions, moduleParams: $moduleParams, url: $url) { content customResponseAttributes meta } }`;

export function pageUrl(page: number): string {
  const variables = { moduleParams: { gti: "", loginStatus: "anonymous" }, url: { path: `${SALE_PATH}?page=${page}` } };
  const q = new URLSearchParams({
    ultasite: "en-us",
    "user-agent": "gomez",
    query: PAGE_QUERY,
    variables: JSON.stringify(variables),
    operationName: "Page",
  });
  return `${SITE}/dxl/graphql?${q}`;
}

/** Every product card in a Page response, wherever the module tree nests it. */
export function cardsOf(data: unknown): any[] {
  const out: any[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.productId && o.productName && "listPrice" in o && "salePrice" in o) {
      out.push(o);
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return out;
}

const num = (v: unknown): number | null => {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string" && typeof s !== "number") return null;
  if (typeof s === "string" && /-|–/.test(s.trim().slice(1))) return null; // a range
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function mapUltaCard(c: any): ProductRecord | null {
  const t = c?.dataCapture?.dataLayer?.Tealium ?? {};
  const list = num(t.product_price) ?? num(c?.listPrice);
  const sale = num(t.product_sale_price) ?? num(c?.salePrice);
  if (!c?.productId || list == null || sale == null || !(sale < list)) return null;
  const img = typeof c?.image?.imageUrl === "string" ? c.image.imageUrl : null;
  const alt = typeof c?.altImage?.imageUrl === "string" ? c.altImage.imageUrl : null;
  const url = typeof c?.action?.url === "string" ? c.action.url : `${SITE}/p/${c.productId}${c.skuId ? `?sku=${c.skuId}` : ""}`;
  return {
    brand: "ulta",
    country: "US",
    externalId: String(c.productId),
    name: [c.brandName, c.productName].filter(Boolean).join(" ").trim(),
    url,
    imageUrl: img,
    images: cleanGallery([img, alt], img),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: true, // the sale grid lists purchasable skus only
    category: typeof c.brandName === "string" ? c.brandName : null,
    gender: null,
    variants: null,
    colorName: null,
  };
}

export async function listUlta(country: CountryCode = "US"): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(pageUrl(page), {
      country: "US",
      headers: { "apollo-require-preflight": "true", "x-apollo-operation-name": "Page" },
    }).catch((e) => {
      if (page === 1) throw e;
      return null;
    });
    const cards = cardsOf(data);
    for (const c of cards) {
      const r = mapUltaCard(c);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (cards.length < PER_PAGE) break;
  }
  return [...byId.values()].slice(0, CAP);
}

export const brand = "ulta";
export const listProducts = listUlta;
