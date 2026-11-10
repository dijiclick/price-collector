/**
 * Omoda (NL) — multi-brand shoes, clothing and bags; the SALE flag of its own
 * Algolia index (2026-11-10).
 *
 * omoda.nl is Salesforce Commerce Cloud with Algolia's cartridge; the listing
 * page prints the public search config (`algoliaConfig`: application
 * `S5G0NASR2V`, a search-only key, index `…__omoda__products__default`). The key
 * is referer-restricted ("Method not allowed with this referer" without one), so
 * every call sends `Referer: https://www.omoda.nl/`. Verified from a GitHub
 * runner with these exact headers (probe run 42802174828) and from the Mac.
 *
 * One record = one colour of a style. `variants[]` has one entry per size with
 * `price.EUR`, `listPrice.EUR` and `in_stock`; `isSale` marks reduced records
 * (2026-11-10: 23,892 of 40,414; 13,880 of them women's). Algolia serves at
 * most 1,000 hits per query, so the walk is split by department
 * (`__primary_category.1`), women's first. Records priced differently per size
 * (`isPriceRange`) are skipped. omoda.be / omoda.de are separate SFCC sites
 * without this index and are not collected here.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.omoda.nl";
const APP = "S5G0NASR2V";
const KEY = "a3398c832c8f5caced15a6b872267b62"; // public search-only key from the page
const INDEX = "production_eu01_omodaschoenenbv__omoda__products__default";
const PER_PAGE = 100;
const CAP = 2500;
const PAUSE_MS = Number(process.env.OMODA_PAUSE_MS ?? 250);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Department → how many pages of 100 (Algolia stops at 1,000 hits a query). */
export const OMODA_TREES: { dept: string; pages: number }[] = [
  { dept: "Dames > Schoenen", pages: 10 },
  { dept: "Dames > Kleding", pages: 8 },
  { dept: "Dames > Accessoires", pages: 3 },
  { dept: "Heren > Schoenen", pages: 3 },
  { dept: "Heren > Kleding", pages: 2 },
];
const ATTRS = ["name", "brand", "url", "image", "image_groups", "variants", "category", "subsoort", "color", "masterID", "Doelgroep", "isSale", "isPriceRange"];

export const queryBody = (dept: string, page: number): string =>
  JSON.stringify({
    query: "",
    hitsPerPage: PER_PAGE,
    page,
    filters: `isSale:true AND __primary_category.1:"${dept}"`,
    attributesToRetrieve: ATTRS,
    attributesToHighlight: [],
  });

const GENDER: Record<string, ProductRecord["gender"]> = { Dames: "kadin", Heren: "erkek", Meisjes: "cocuk", Jongens: "cocuk", Baby: "cocuk" };

/** One Algolia hit → a record, or null when it is not a clean markdown. Pure. */
export function mapOmoda(h: any, country: CountryCode = "NL"): ProductRecord | null {
  if (!h?.objectID || !h.name || typeof h.url !== "string" || h.isPriceRange === true) return null;
  const variants: any[] = Array.isArray(h.variants) ? h.variants : [];
  if (!variants.length) return null;
  const lead = variants.find((v) => v?.in_stock) ?? variants[0];
  const price = Math.round(Number(lead?.price?.EUR) * 100);
  const was = Math.round(Number(lead?.listPrice?.EUR) * 100);
  if (!(price > 0) || !(was > price)) return null;
  // One price for the whole colour: a size priced differently makes "was" ambiguous.
  if (variants.some((v) => Math.round(Number(v?.price?.EUR) * 100) !== price)) return null;
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of variants) {
    const list = Array.isArray(v?.size) ? v.size : [];
    const label = String(list[list.length - 1] ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: v.in_stock ? "in_stock" : "out_of_stock" });
  }
  const image = typeof h.image === "string" && h.image.startsWith("https://") ? h.image : null;
  const g = h.image_groups ?? {};
  const maker = String(h.brand ?? "").trim() || null;
  return {
    brand: "omoda",
    country,
    externalId: String(h.objectID),
    name: String(h.name).trim(),
    url: `${ORIGIN}${h.url}`,
    imageUrl: image,
    images: cleanGallery([g.primary?.large, g.hover?.large], image),
    price,
    listPrice: was,
    currency: "EUR",
    inStock: variants.some((v) => v?.in_stock),
    maker,
    category: String(h.subsoort ?? h.category ?? "").trim() || null,
    gender: GENDER[String((Array.isArray(h.Doelgroep) ? h.Doelgroep[0] : h.Doelgroep) ?? "")] ?? null,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: h.masterID ? `omoda:${h.masterID}` : null,
    colorName: Array.isArray(h.color) && h.color[0] ? String(h.color[0]) : null,
  };
}

const defaultFetch = (country: CountryCode) => (body: string) =>
  getJson(`https://${APP}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
    country,
    method: "POST",
    body,
    headers: {
      "x-algolia-application-id": APP,
      "x-algolia-api-key": KEY,
      "content-type": "application/json",
      Referer: `${ORIGIN}/`,
      Origin: ORIGIN,
    },
  });

export async function listOmoda(country: CountryCode, query: (body: string) => Promise<any> = defaultFetch(country)): Promise<ProductRecord[]> {
  if (country !== "NL") return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  let seen = 0;
  for (const tree of OMODA_TREES) {
    for (let page = 0; page < tree.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let res: any;
      try {
        res = await query(queryBody(tree.dept, page));
      } catch (err) {
        if (calls === 1) throw err;
        break;
      }
      const hits: any[] = Array.isArray(res?.hits) ? res.hits : [];
      if (calls === 1 && hits.length === 0) throw new Error("omoda: no sale hits on the first page (index or key changed?)");
      seen += hits.length;
      for (const h of hits) {
        const r = mapOmoda(h, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (hits.length < PER_PAGE || page + 1 >= Number(res?.nbPages ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`omoda/${country}: ${calls} queries, ${seen} hits, ${all.length} reduced, kept ${out.length}`);
  return out;
}
