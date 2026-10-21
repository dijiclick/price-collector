/**
 * KIKO Milano, Italy (kikocosmetics.com/it-it) — EUR. Added 2026-10-21;
 * ES PT FR DE AT NL BE IE GB CH the same day (see KIKO_MARKETS).
 *
 * Not the Turkish store's platform (`kiko.ts`, Akinon): the EU site is a
 * Next.js front on New Black's EVA, and its catalogue search is Algolia — app
 * `S6XPHBOA7P`, the public search key from the site bundle, index
 * `<organizationUnitId>_<locale>` = `286_it-IT` (org unit 286 = KIKO-IT, in
 * the page's `__NEXT_DATA__`). Algolia answers a GitHub runner directly
 * (probe run 39635106148), no proxy.
 *
 * - One record per shade (`distinct=0`; the site groups them by base product).
 * - `prices.oldValue` is the struck price the product tiles show
 *   (`product-price-algolia_originalPrice`), `prices.value` the selling price;
 *   the numeric filter keeps only shades that carry one — 424 of 2,212 on
 *   2026-10-21, one request. Multi-buy promos ("3x2") have no `oldValue` and
 *   are not deals.
 * - `stockStatus` is the shade's own online stock.
 * - Product page: `/it-it/p/<slug>-<objectID>/`.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = "S6XPHBOA7P";
const KEY = "19c2c0483072a7a0ab5e61bddba918ad";
const SITE = "https://www.kikocosmetics.com";

/**
 * Market → Algolia index (`<EVA org unit>_<locale>`, org unit from each locale
 * page's `__NEXT_DATA__`) / path / currency. The rest of Europe added
 * 2026-10-21: every index answered with ~415 struck shades out of ~2.2k (GB
 * 198 of 1,850), the same ~30% markdown the product pages show. Belgium is one
 * org unit (660) in nl/fr; Switzerland one (944) in de/fr/it — the German
 * index is the fuller one (418 vs 392).
 */
export const KIKO_MARKETS: Partial<Record<CountryCode, { index: string; path: string; currency?: string }>> = {
  IT: { index: "286_it-IT", path: "it-it" },
  ES: { index: "657_es-ES", path: "es-es" },
  PT: { index: "972_pt-PT", path: "pt-pt" },
  FR: { index: "100_fr-FR", path: "fr-fr" },
  DE: { index: "917_de-DE", path: "de-de" },
  AT: { index: "1063_de-AT", path: "de-at" },
  NL: { index: "663_nl-NL", path: "nl-nl" },
  BE: { index: "660_nl-BE", path: "nl-be" },
  IE: { index: "1069_en-IE", path: "en-ie" },
  GB: { index: "666_en-GB", path: "en-gb", currency: "GBP" },
  CH: { index: "944_de-CH", path: "de-ch", currency: "CHF" },
};

const ATTRS = "objectID,name,slug,prices,stockStatus,baseBackendId,baseProduct,color,categories,images,prodlast_hier_custom_ba_5,code";
const CAP = 1500;

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** Map one shade record (deals only). Pure. */
export function mapKikoIt(h: any, country: CountryCode = "IT"): ProductRecord | null {
  const m = KIKO_MARKETS[country];
  const price = Number(h?.prices?.value);
  const was = Number(h?.prices?.oldValue);
  const name = clean(h?.name);
  if (!m || !h?.objectID || !name || !clean(h?.slug)) return null;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const image = typeof h?.images?.url === "string" ? h.images.url : null;
  // "LIP CARE", "FLUID FOUNDATION" — but also seasonal collection names
  // ("SUMMER 2025", "RAMADAN COLLECTION 2026"), which say nothing of the type.
  const rawLine = clean(h?.prodlast_hier_custom_ba_5);
  const line = /\d{2}|collection|capsule|holiday|summer|spring|fall|winter|valentine|unlimited|gift/i.test(rawLine) ? "" : rawLine;
  const base = clean(h?.baseBackendId);
  return {
    brand: "kiko",
    country,
    externalId: String(h.objectID),
    name,
    url: `${SITE}/${m.path}/p/${clean(h.slug)}-${h.objectID}/`,
    imageUrl: image,
    images: image ? [image] : null,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: m.currency ?? "EUR",
    inStock: h.stockStatus === true,
    category: line ? line.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : null,
    gender: null,
    groupKey: base ? `kiko:${base}` : null,
    colorName: clean(h?.color) || null,
  };
}

/** Register as `(c) => c === "TR" ? kiko.listProducts("TR") : listKikoIt(c)`. */
export async function listKikoIt(country: CountryCode): Promise<ProductRecord[]> {
  const m = KIKO_MARKETS[country];
  if (!m) return [];
  const params =
    `hitsPerPage=1000&distinct=0&numericFilters=${encodeURIComponent("prices.oldValue>0")}` +
    `&attributesToHighlight=${encodeURIComponent("[]")}&attributesToRetrieve=${encodeURIComponent(ATTRS)}`;
  const d = await getJson<any>(`https://${APP}-dsn.algolia.net/1/indexes/${m.index}/query`, {
    method: "POST",
    country,
    timeoutMs: 30_000,
    headers: { "X-Algolia-Application-Id": APP, "X-Algolia-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });
  if (!Array.isArray(d?.hits)) throw new Error(`kiko/${country}: bad Algolia answer`);
  if (Number(d.nbHits) > d.hits.length) throw new Error(`kiko/${country}: ${d.nbHits} deals, one page holds ${d.hits.length}`);
  const rows = d.hits.map((h: any) => mapKikoIt(h, country)).filter((r: ProductRecord | null): r is ProductRecord => r !== null);
  return [...rows.filter((r: ProductRecord) => r.inStock), ...rows.filter((r: ProductRecord) => !r.inStock)].slice(0, CAP);
}
