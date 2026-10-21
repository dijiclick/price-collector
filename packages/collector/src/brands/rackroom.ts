/**
 * Rack Room Shoes (rackroomshoes.com, US only) — multi-brand family shoe store.
 *
 * The website and its OCC API are behind Incapsula, but the storefront's
 * product listings come from Algolia, with the app id, search-only key and
 * index in its own bundle (`main.*.js` → `algolia: { appId: "7CUHTHVKMM", … }`):
 *
 *   POST https://7cuhthvkmm-dsn.algolia.net/1/indexes/prod_rackroom_products_v1/query
 *        { facetFilters: [["sale:true"], ["gender:WOMENS"]], hitsPerPage: 1000 }
 *
 * One hit = one style/colour (`sku`), with `price` (selling) and `priceOriginal`
 * (the regular price the site strikes through). `availability` is
 * "Deliverable" or "In-Store Only" — the latter is kept but marked out of stock
 * (it cannot be bought online). `brand` is the maker. Algolia caps a query at
 * 1,000 hits, so the sale is read per gender.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "rackroom";

const SITE = "https://www.rackroomshoes.com";
const ALGOLIA = "https://7cuhthvkmm-dsn.algolia.net/1/indexes/prod_rackroom_products_v1/query";
const HEADERS = {
  "X-Algolia-Application-Id": "7CUHTHVKMM",
  "X-Algolia-API-Key": "0ace919e79993a4530700d0b32a1c429",
  "Content-Type": "application/json",
};
const CAP = 1500;
const ATTRS = ["sku", "name", "brand", "price", "priceOriginal", "gender", "thumbnail", "availability", "deliverable", "category", "colors"];

/** Per-gender walks and how many rows each may contribute. */
export const RACKROOM_WALKS: [gender: string, our: ProductRecord["gender"], share: number][] = [
  ["WOMENS", "kadin", 800],
  ["MENS", "erkek", 450],
  ["GIRLS", "cocuk", 125],
  ["BOYS", "cocuk", 125],
];

export const queryBody = (gender: string) =>
  JSON.stringify({
    query: "",
    hitsPerPage: 1000,
    page: 0,
    facetFilters: [["sale:true"], [`gender:${gender}`]],
    attributesToRetrieve: ATTRS,
    attributesToHighlight: [],
  });

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Map one Algolia hit. Pure; null unless priceOriginal > price. */
export function mapRackRoom(h: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const sku = h?.sku != null ? String(h.sku) : "";
  const name = String(h?.name ?? "").trim();
  const price = Number(h?.price);
  const list = Number(h?.priceOriginal);
  if (!sku || !name || !(price > 0) || !(list > price)) return null;
  const make = typeof h.brand === "string" && h.brand.trim() ? h.brand.trim() : null;
  const pretty = title(name);
  const full = make && !pretty.toLowerCase().includes(make.toLowerCase()) ? `${make} ${pretty}` : pretty;
  const img = typeof h.thumbnail === "string" && h.thumbnail ? h.thumbnail : null;
  const cats: string[] = Array.isArray(h.category) ? h.category : [];
  const kind = cats.find((c) => !/promotions|on sale|best seller|top picks|new arrival|clearance|exclusive/i.test(c)) ?? null;
  return {
    brand,
    country: "US",
    externalId: sku,
    name: full,
    url: `${SITE}/p/${slug(full)}/${sku}`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: h.deliverable !== false && h.availability !== "In-Store Only",
    category: kind,
    maker: make,
    gender,
    variants: null,
    groupKey: null,
    colorName: Array.isArray(h.colors) && h.colors[0] ? title(String(h.colors[0])) : null,
  };
}

export async function listRackRoom(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  for (const [g, gender, share] of RACKROOM_WALKS) {
    const d = await getJson<any>(ALGOLIA, { country, method: "POST", headers: HEADERS, body: queryBody(g), retries: 1, timeoutMs: 30_000 });
    const hits: any[] = Array.isArray(d?.hits) ? d.hits : [];
    if (!hits.length && g === "WOMENS") throw new Error("rackroom: Algolia returned no sale hits");
    const rows = hits.map((h) => mapRackRoom(h, gender)).filter((r): r is ProductRecord => r != null);
    const ranked = [...rows.filter((r) => r.inStock), ...rows.filter((r) => !r.inStock)];
    let added = 0;
    for (const r of ranked) {
      if (added >= share) break;
      if (!byId.has(r.externalId)) byId.set(r.externalId, r), added++;
    }
  }
  return [...byId.values()].slice(0, CAP);
}

export const listProducts = listRackRoom;
