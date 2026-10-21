/**
 * Intersport France through the Algolia index its own storefront searches.
 *
 * intersport.fr (SAP Commerce) is behind DataDome on every page, but its
 * search runs on Algolia with a public search-only key printed in the page
 * config (`ACC.config.algoliaApplicationId` / `algoliaApiSearchKey`, index
 * `ACC.algoliasearch.productsIndexName`). Algolia answers a plain request —
 * no proxy.
 *
 * One hit is one colour. `priceCutKind` says what the struck price means:
 *   - "DISCOUNT": a real markdown — `promotionPrice` (= `minPrice`) against
 *     `priceMinValue`, the price it sold at; `skuPrice` repeats it per size as
 *     `sku|base|…|…|promo|percent`.
 *   - "PVI" ("Prix Intersport"): the store's everyday price against a
 *     manufacturer's reference it never charged — NOT a discount, dropped.
 * Only DISCOUNT rows are fetched (`filters=priceCutKind:DISCOUNT`, ~2,300).
 * Algolia stops at 1,000 hits per query, so the set is read in slices by
 * `GenreProduit`, plus one catch-all for rows with none.
 *
 * `skusCodeAndSize` is `sku|ean|size|available|qty|…` per size: real per-size
 * stock and the EAN printed on the tag. Shoe sizes come as "402/3" = 40⅔.
 * Equipment (skis, poles, helmets, balls, bikes, watches …) is dropped: sport
 * clothing, shoes, bags and accessories only.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "intersport";

const APP_ID = "6S3KKYKKUG";
const API_KEY = "fa71c170f369b8546a66e47a511f49d8"; // public search-only key from the storefront config
export const INTERSPORT_MARKETS: Partial<Record<CountryCode, { index: string; site: string }>> = {
  FR: { index: "tris_emerchScore-desc_1905", site: "https://www.intersport.fr" },
};
const CAP = 1500;
/** GenreProduit codes seen on the reduced rows (2026-10-21); each slice stays far under 1,000. */
const GENRES = ["0B.1", "0B.2", "0B.3", "0B.4", "0B.5", "0B.6", "0B.7", "0B.8", "0B.9"];
const ATTRS = [
  "objectID", "code", "baseProductCode", "name", "nameBlock", "brandName", "url", "imageUrls", "priceCutKind",
  "promotionPrice", "minPrice", "priceMinValue", "skuPrice", "skusCodeAndSize", "genderName", "TypeProduit",
  "categoryAndSubCategory", "displayColor", "inStockFlag", "hasFidPrice",
].join(",");

/** Not clothing, shoes, bags or wearable accessories. */
const EQUIPMENT =
  /^(b[aâ]ton|casque|masque|skis?$|ballon|balle|raquette|fixation|protection|prot[eè]ge|housse|montre|semelles|v[eé]lo|vtt|entretien|planche|snowboard|imperm|luge|sangle|tige|t[eé]l[eé]phone|gants de gardien|chambre|gourde|accessoire|visi[eè]re|trottinette|tapis|halt[eè]re|lunettes|pompe|filet|cible|but|panier|tente|duvet|matelas|r[eé]chaud|frontale|batterie|[eé]clairage|antivol|porte-bidon|bidon|compteur|pneu|selle|p[eé]dale|guidon|cadre|roue)/i;

export function intersportQuery(country: CountryCode, slice: string): { url: string; body: string } | null {
  const m = INTERSPORT_MARKETS[country];
  if (!m) return null;
  const params = new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    page: "0",
    filters: `priceCutKind:DISCOUNT AND ${slice}`,
    attributesToRetrieve: ATTRS,
    attributesToHighlight: "[]",
  });
  return { url: `https://${APP_ID}-dsn.algolia.net/1/indexes/${m.index}/query`, body: JSON.stringify({ params: params.toString() }) };
}

export const SLICES = [...GENRES.map((g) => `GenreProduit:"${g}"`), GENRES.map((g) => `NOT GenreProduit:"${g}"`).join(" AND ")];

/** "402/3" → "40 2/3", "411/3" → "41 1/3", "42" → "42". */
export const sizeLabel = (s: string): string => s.replace(/^(\d{2})([12]\/3)$/, "$1 $2").trim();

const GENDER: Record<string, ProductRecord["gender"]> = {
  homme: "erkek", femme: "kadin", garçon: "cocuk", garcon: "cocuk", fille: "cocuk", enfant: "cocuk", "bébé": "cocuk", bebe: "cocuk", junior: "cocuk",
};
function genderOf(names: unknown): ProductRecord["gender"] {
  const list = Array.isArray(names) ? names.map((n) => String(n).toLowerCase()) : [];
  const g = [...new Set(list.map((n) => GENDER[n]).filter(Boolean))];
  return g.length === 1 ? g[0]! : null;
}

const img = (u: string): string => `${u.startsWith("//") ? "https:" : ""}${u.split("?")[0]}?wid=800&hei=800&fmt=jpg`;

/** Map one hit (one colour). Pure; null unless it is a genuine markdown on a wearable. */
export function mapIntersportHit(hit: any, country: CountryCode): ProductRecord | null {
  const m = INTERSPORT_MARKETS[country];
  if (!m || !hit?.objectID || typeof hit.url !== "string") return null;
  if (hit.priceCutKind !== "DISCOUNT" || hit.hasFidPrice === true) return null;
  const type = Array.isArray(hit.TypeProduit) ? String(hit.TypeProduit[0] ?? "") : "";
  if (EQUIPMENT.test(type)) return null;

  // Per-size prices: keep the lowest promo price and the base it is struck against.
  let paid = Number(hit.promotionPrice ?? hit.minPrice);
  let was = Number(hit.priceMinValue);
  for (const row of Array.isArray(hit.skuPrice) ? hit.skuPrice : []) {
    const f = String(row).split("|");
    const base = Number(f[1]);
    const promo = Number(f[4]);
    if (f[4] !== "null" && promo > 0 && base > promo && (!(paid > 0) || promo <= paid)) {
      paid = promo;
      was = base;
    }
  }
  if (!(paid > 0) || !(was > paid)) return null;

  const sizes: SizeVariant[] = [];
  const barcodes: string[] = [];
  for (const row of Array.isArray(hit.skusCodeAndSize) ? hit.skusCodeAndSize : []) {
    const f = String(row).split("|");
    const label = sizeLabel(f[2] ?? "");
    if (/^\d{8,14}$/.test(f[1] ?? "")) barcodes.push(f[1]);
    if (!label || sizes.some((s) => s.label === label)) continue;
    sizes.push({ label, availability: f[3] === "true" ? "in_stock" : "out_of_stock" });
  }
  const photos = (Array.isArray(hit.imageUrls) ? hit.imageUrls : []).filter((u: unknown): u is string => typeof u === "string").map(img);
  const name = String(hit.nameBlock ?? hit.name ?? "").replace(/\s+/g, " ").trim();
  const make = typeof hit.brandName === "string" ? hit.brandName.trim() : "";
  const colour = typeof hit.displayColor === "string" && hit.displayColor ? hit.displayColor : null;
  return {
    brand,
    country,
    externalId: String(hit.code ?? hit.objectID),
    name: make && !name.toUpperCase().includes(make.toUpperCase()) ? `${make} ${name}` : name,
    url: `${m.site}${hit.url}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(paid),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : hit.inStockFlag !== false,
    barcodes: barcodes.length ? barcodes : null,
    category: type || String(hit.categoryAndSubCategory ?? "").split("|")[0] || null,
    maker: make || null,
    gender: genderOf(hit.genderName),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: hit.baseProductCode ? `intersport-${hit.baseProductCode}` : null,
    colorName: colour,
  };
}

export async function listIntersport(country: CountryCode): Promise<ProductRecord[]> {
  if (!INTERSPORT_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  for (const [i, slice] of SLICES.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    const q = intersportQuery(country, slice)!;
    const data = await getJson<any>(q.url, {
      country,
      method: "POST",
      body: q.body,
      headers: { "x-algolia-application-id": APP_ID, "x-algolia-api-key": API_KEY, "content-type": "application/json" },
    });
    if (Number(data?.nbHits) > 1000) console.warn(`intersport/${country}: slice ${slice} has ${data.nbHits} hits; only 1000 returned`);
    for (const h of data?.hits ?? []) {
      const r = mapIntersportHit(h, country);
      if (r) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listIntersport;
