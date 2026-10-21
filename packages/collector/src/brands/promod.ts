/**
 * Promod (France) through the Algolia index its own storefront searches.
 *
 * promod.fr is a Nuxt app; the product grid is Algolia with a public,
 * search-only key in the page config (`algoliaApplicationId` /
 * `algoliaSearchApiKey`). The index name is built in the bundle as
 * `${environment}_PRODUCTS_${storeId}_${algoliaLocale}` → `prod_PRODUCTS_406_fr_FR`.
 *
 * One hit is one colour of one model. `prices.initialPrice` is the reference
 * price the site strikes through (`strikeThroughPrice`), `currentPrice` the
 * price paid; `prices.type` is "P" on a promotion and "I" at full price. The
 * key carries its own filters (published, not offline, stock online or in
 * stores) and a query rule adds "online stock only" when `isOnPromotion` is
 * filtered on, so the numeric `prices.discount > 0` filter is used instead —
 * it keeps the in-store-only reduced colours too (marked out of stock here).
 *
 * The feed has the size run but not per-size stock; sizes are listed only when
 * `availableSizePct` is 100 (every size buyable). Fabric coupons and sewing
 * patterns (family 118) are not clothing and are dropped. Promod is women-only.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "promod";

const APP_ID = "DS34YD0WD5";
const API_KEY = "e54583482d1f34a1626008e42dc2b369"; // public search-only key from the storefront config
export const PROMOD_MARKETS: Partial<Record<CountryCode, { index: string; site: string }>> = {
  FR: { index: "prod_PRODUCTS_406_fr_FR", site: "https://www.promod.fr/fr-fr" },
};
const IMG = "https://asset.promod.com";
const CAP = 1500;
/** Not clothing: fabric coupons and sewing patterns. */
const SKIP_FAMILIES = new Set([118]);
const ATTRS = [
  "objectID", "productId", "optionId", "label", "url", "prices", "pictures", "recommendedPicture", "colors",
  "sizes", "productFamily", "productSubFamily", "isAvailableOnline", "availableSizePct", "model",
].join(",");

export function promodQuery(country: CountryCode): { url: string; body: string } | null {
  const m = PROMOD_MARKETS[country];
  if (!m) return null;
  const params = new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    page: "0",
    filters: "prices.discount > 0",
    attributesToRetrieve: ATTRS,
    attributesToHighlight: "[]",
  });
  return { url: `https://${APP_ID}-dsn.algolia.net/1/indexes/${m.index}/query`, body: JSON.stringify({ params: params.toString() }) };
}

/** Pictures in display order: the recommended one, then on-model/flat shots. */
function photos(hit: any): string[] {
  const order = ["GZ", "AP", "DP", "ZM", "SU", "LB1", "LB2", "LB3"];
  const pics: { path: string; type: string }[] = Array.isArray(hit.pictures) ? hit.pictures : [];
  const sorted = [...pics].sort((a, b) => (order.indexOf(a.type) + 99) % 99 - (order.indexOf(b.type) + 99) % 99);
  const paths = [hit.recommendedPicture, ...sorted.map((p) => p?.path)].filter((p): p is string => typeof p === "string" && p.startsWith("/"));
  return paths.map((p) => IMG + p);
}

/** Map one hit (one colour). Pure; null unless genuinely reduced. */
export function mapPromodHit(hit: any, country: CountryCode): ProductRecord | null {
  const m = PROMOD_MARKETS[country];
  if (!m || !hit?.objectID || typeof hit.url !== "string") return null;
  if (SKIP_FAMILIES.has(Number(hit.productFamily?.id))) return null;
  const p = hit.prices ?? {};
  const cur = Number(p.currentPrice);
  const was = Number(p.strikeThroughPrice ?? p.initialPrice);
  if (!(cur > 0) || !(was > cur) || p.currency !== "EUR") return null;

  const imgs = photos(hit);
  const colour = typeof hit.colors?.detailedColorLabel === "string" ? hit.colors.detailedColorLabel : null;
  const sizes: SizeVariant[] =
    Number(hit.availableSizePct) === 100 && Array.isArray(hit.sizes)
      ? hit.sizes.map((s: any) => ({ label: String(s?.label ?? ""), availability: "in_stock" as const })).filter((s: SizeVariant) => s.label)
      : [];
  return {
    brand,
    country,
    externalId: String(hit.objectID),
    name: String(hit.label ?? "").replace(/\s+/g, " ").trim(),
    url: `${m.site}${hit.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(cur),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: hit.isAvailableOnline !== false,
    category: hit.productSubFamily?.label ?? hit.productFamily?.label ?? null,
    gender: "kadin",
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: hit.model?.id ? `promod-${hit.model.id}` : null,
    colorName: colour,
  };
}

export async function listPromod(country: CountryCode): Promise<ProductRecord[]> {
  const q = promodQuery(country);
  if (!q) return [];
  const data = await getJson<any>(q.url, {
    country,
    method: "POST",
    body: q.body,
    headers: { "x-algolia-application-id": APP_ID, "x-algolia-api-key": API_KEY, "content-type": "application/json" },
  });
  if (Number(data?.nbHits) > 1000) console.warn(`promod/${country}: ${data.nbHits} reduced hits; only 1000 returned`);
  const byId = new Map<string, ProductRecord>();
  for (const h of data?.hits ?? []) {
    const r = mapPromodHit(h, country);
    if (r) byId.set(r.externalId, r);
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listPromod;
