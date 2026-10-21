/**
 * Decathlon Singapore (decathlon.sg), 2026-10-21 — a separate platform from the
 * European shops `decathlon.ts` reads: Decathlon APAC's own Next.js storefront
 * ("chopper"), whose search runs on Algolia. The app id and search-only key are
 * public, in the page's `__NEXT_DATA__` runtimeConfig
 * (`NEXT_PUBLIC_ALGOLIA_APP_ID` / `_APP_KEY`), and the index is queried
 * directly — no page is ever read, no proxy.
 *
 * Index `prod_pim_v3_index_discount_desc` (deepest discount first). One hit is
 * one model (colour); `price` / `priceBeforeDiscount` are the shop's own
 * current and crossed-out price in SGD, the same pair the product card prints.
 *
 * Filters:
 * - `sellerType:decathlon` — the index also holds ~47k marketplace offers
 *   ("Pertemba SG (Ships from Overseas)" and others) with "was" prices like
 *   S$105.99 → S$8.54 that are the partner's, not Decathlon's; left out.
 * - `productCondition:new` — no "Second Life" refurbished items.
 * - one query per gender group (women, men, kids), which keeps the sports
 *   clothing/shoes/accessories and drops gender-less equipment (bikes,
 *   tents, weights). Each query must fit Algolia's 1,000-hit page or it throws.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "decathlon";

const APP_ID = "LR431A4C5G";
const API_KEY = "059b7b67675acd819ce0776ae86a7e6c"; // public search-only key from decathlon.sg
const INDEX = "prod_pim_v3_index_discount_desc";
const SITE = "https://www.decathlon.sg";
const HITS = 1000; // Algolia's default paginationLimitedTo
const CAP = 1500;

export const GENDER_GROUPS: { facet: string[]; gender: ProductRecord["gender"] }[] = [
  { facet: ["gender_en:WOMEN", "gender_en:WOMEN'S"], gender: "kadin" },
  { facet: ["gender_en:MEN", "gender_en:MEN'S"], gender: "erkek" },
  {
    facet: ["gender_en:GIRLS", "gender_en:BOYS", "gender_en:KIDS", "gender_en:GIRLS'", "gender_en:BOYS'", "gender_en:BABY GIRLS", "gender_en:BABY BOYS", "gender_en:BABY"],
    gender: "cocuk",
  },
];

export function queryBody(facet: string[]): string {
  const p = new URLSearchParams({
    query: "",
    hitsPerPage: String(HITS),
    page: "0",
    facetFilters: JSON.stringify(["sellerType:decathlon", "productCondition:new", facet]),
    numericFilters: JSON.stringify(["percentage>0"]),
    attributesToRetrieve: JSON.stringify([
      "objectID", "modelId", "superModelId", "name_en", "brand", "price", "priceBeforeDiscount", "currency",
      "url_en", "smallUrl", "otherImages", "availability", "available", "productNature_en", "colorName_en", "gender_en",
    ]),
    attributesToHighlight: "[]",
  });
  return JSON.stringify({ params: p.toString() });
}

/** Map one hit. Pure; null unless Decathlon's own price is reduced. */
export function mapHit(h: any, gender: ProductRecord["gender"], country: CountryCode = "SG"): ProductRecord | null {
  const price = Number(h?.price);
  const was = Number(h?.priceBeforeDiscount);
  if (!h?.objectID || !h?.name_en || !h?.url_en) return null;
  if (!(price > 0 && was > price)) return null;
  if (h.currency && h.currency !== "SGD") throw new Error(`decathlon/${country}: hit priced in ${h.currency}`);
  const imgs: string[] = [h.smallUrl, ...(h.otherImages ?? [])].filter((u: unknown): u is string => typeof u === "string");
  const colour = typeof h.colorName_en === "string" && h.colorName_en.trim() ? h.colorName_en.split(",").map((s: string) => s.trim()).join(" / ") : null;
  return {
    brand,
    country,
    externalId: String(h.modelId ?? h.objectID),
    name: String(h.name_en).trim(),
    url: `${SITE}${h.url_en}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "SGD",
    inStock: h.available !== false && h.availability !== "Unavailable",
    category: typeof h.productNature_en === "string" ? h.productNature_en : null,
    gender,
    maker: typeof h.brand === "string" && h.brand ? h.brand : null, // as decathlon.ts: the house brand (NABAIJI, QUECHUA…)
    variants: null,
    groupKey: h.superModelId ? `decathlon-sg:${h.superModelId}` : null,
    colorName: colour,
  };
}

export async function listDecathlonSg(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "SG") return [];
  const byId = new Map<string, ProductRecord>();
  for (const g of GENDER_GROUPS) {
    const d = await getJson<any>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
      method: "POST",
      country,
      headers: { "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": API_KEY, "Content-Type": "application/json" },
      body: queryBody(g.facet),
    });
    if (!Array.isArray(d?.hits)) throw new Error(`decathlon/${country}: malformed Algolia answer`);
    if (Number(d.nbHits) > HITS) throw new Error(`decathlon/${country}: ${d.nbHits} hits for ${g.gender}, over one page of ${HITS}`);
    for (const h of d.hits) {
      const r = mapHit(h, g.gender, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
