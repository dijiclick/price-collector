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
 *
 * Algolia's `prices` go stale (2026-11-11): the 30% sale ended on every EU
 * site, yet 44 DE shades still carried `oldValue 22.99 / value 16.09` while
 * the product page and the cart charged 22.99 (EVA `display_price`; the
 * page's `historical_price` is the Omnibus 30-day low — the old sale price).
 * So every selling price is confirmed against EVA's own anonymous
 * `SearchProducts` (`api.euw.kiko.prod.eva-online.cloud`, org unit = the
 * index prefix, 100 ids per call). A shade is a deal only when EVA's price is
 * under Algolia's `oldValue`. Between sales the run is topped up with in-stock
 * full-price shades (listPrice null), as Gullfunn/COS do, so the brand page
 * stays filled and a later markdown is a real drop.
 */
import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = "S6XPHBOA7P";
const KEY = "19c2c0483072a7a0ab5e61bddba918ad";
const SITE = "https://www.kikocosmetics.com";
const EVA = "https://api.euw.kiko.prod.eva-online.cloud/message/SearchProducts";

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
  const r = mapKikoShade(h, country, Number(h?.prices?.value));
  return r && r.listPrice != null ? r : null;
}

/**
 * Map one shade at `price` (major units, EVA's live price). It is a deal only
 * when Algolia's struck `oldValue` is above it; otherwise listPrice is null.
 */
export function mapKikoShade(h: any, country: CountryCode, price: number): ProductRecord | null {
  const m = KIKO_MARKETS[country];
  const was = Number(h?.prices?.oldValue);
  const name = clean(h?.name);
  if (!m || !h?.objectID || !name || !clean(h?.slug)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
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
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: m.currency ?? "EUR",
    inStock: h.stockStatus === true,
    category: line ? line.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : null,
    gender: null,
    groupKey: base ? `kiko:${base}` : null,
    colorName: clean(h?.color) || null,
  };
}

async function algolia(m: { index: string }, country: CountryCode, filter: string): Promise<any[]> {
  const params =
    `hitsPerPage=1000&distinct=0&${filter}` +
    `&attributesToHighlight=${encodeURIComponent("[]")}&attributesToRetrieve=${encodeURIComponent(ATTRS)}`;
  const d = await getJson<any>(`https://${APP}-dsn.algolia.net/1/indexes/${m.index}/query`, {
    method: "POST",
    country,
    timeoutMs: 30_000,
    headers: { "X-Algolia-Application-Id": APP, "X-Algolia-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });
  if (!Array.isArray(d?.hits)) throw new Error(`kiko/${country}: bad Algolia answer`);
  return d.hits;
}

/** Live selling price per product id from EVA (see the header). */
export async function evaPrices(orgUnit: string, ids: string[], country: CountryCode): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await getJson<any>(EVA, {
      method: "POST",
      country,
      timeoutMs: 30_000,
      headers: { "Content-Type": "application/json", "EVA-User-Agent": "modadrop/1.0", "EVA-Requested-OrganizationUnitID": orgUnit },
      body: JSON.stringify({
        Filters: { product_id: { Values: ids.slice(i, i + 100) } },
        PageSize: 100,
        IncludedFields: ["product_id", "display_price", "is_sellable"],
      }),
    });
    if (!Array.isArray(d?.Products)) throw new Error(`kiko/${country}: bad EVA answer`);
    for (const p of d.Products) {
      const v = Number(p?.display_price);
      if (p?.product_id != null && Number.isFinite(v) && v > 0 && p.is_sellable !== false) out.set(String(p.product_id), v);
    }
  }
  return out;
}

/** Register as `(c) => c === "TR" ? kiko.listProducts("TR") : listKikoIt(c)`. */
export async function listKikoIt(country: CountryCode): Promise<ProductRecord[]> {
  const m = KIKO_MARKETS[country];
  if (!m) return [];
  const struck = await algolia(m, country, `numericFilters=${encodeURIComponent("prices.oldValue>0")}`);
  if (struck.length >= 1000) throw new Error(`kiko/${country}: ${struck.length} struck shades, one page holds 1000`);
  const inStock = await algolia(m, country, `filters=${encodeURIComponent("stockStatus:true")}`);
  const hits = new Map<string, any>();
  for (const h of [...struck, ...inStock]) if (h?.objectID != null && !hits.has(String(h.objectID))) hits.set(String(h.objectID), h);
  const live = await evaPrices(m.index.split("_")[0], [...hits.keys()], country);
  const rows: ProductRecord[] = [];
  for (const [id, h] of hits) {
    const price = live.get(id);
    const r = price == null ? null : mapKikoShade(h, country, price);
    if (r && (r.listPrice != null || r.inStock)) rows.push(r);
  }
  const deals = rows.filter((r) => r.listPrice != null);
  const full = rows.filter((r) => r.listPrice == null);
  return [...deals.filter((r) => r.inStock), ...deals.filter((r) => !r.inStock), ...full].slice(0, CAP);
}
