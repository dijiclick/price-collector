/**
 * Love, Bonito (Singapore), 2026-10-21. Women's fashion, Vue Storefront over
 * Magento with an Elasticsearch catalogue.
 *
 * Route: the storefront's own catalogue service, the call its sale page makes
 * (`fetchProductsByUrlKey` in the Next.js bundle):
 *   GET https://www.lovebonito.com/api-2/es-catalog/catalog/getProducts
 *       ?urlKey=sale&storeCode=sg&count=40&page=N&agg=false
 * Plain JSON, no key, no cookie; `count` is capped at 40 by the server
 * (~24 pages for ~950 products, ~65 KB each).
 *
 * Prices: one hit is a configurable product whose `configurable_children` are
 * colour × size SKUs, each with `regular_price` and `final_price` (SGD,
 * GST-inclusive; `special_price` already folded in with its date window). The
 * sale page lists every product that has ANY marked-down colour, so most hits
 * carry no reduced child at all — those are dropped. A record is one product ×
 * colour whose children are reduced (`final_price < regular_price`): the price
 * is that colour's lowest reduced price (in-stock sizes first), the "was" its
 * regular price, and the sizes are that colour's children with their stock.
 *
 * RESTRICTED SALE (2026-10-31): ahead of 11.11 the shop hides its sale page —
 * the service answers `isRestricted: true` (`restrictedStoryBlokKey`
 * "sg/pages/11-11-teaser") with the real total (1,409) and an EMPTY `hits`
 * list on every page, so five runs collected nothing. Marked-down colours are
 * still on sale in the regular catalogue (`urlKey=shop-all`, 2,332 products in
 * SG, 2,006 in HK; page 30 of SG carried 34 reduced products of 40), so a
 * restricted sale page falls back to walking shop-all, where `mapHit` keeps
 * only the reduced colours as before.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "lovebonito";

export const LOVEBONITO_MARKETS: Partial<Record<CountryCode, { storeCode: string; saleKey: string; path: string }>> = {
  SG: { storeCode: "sg", saleKey: "sale", path: "sg" },
  // Hong Kong (2026-10-21): same service, store "hk", HKD; its sale page is /hk/sale-hk.
  HK: { storeCode: "hk", saleKey: "sale-hk", path: "hk" },
};

const HOST = "https://www.lovebonito.com";
const MEDIA = "https://media.lovebonito.com/media/catalog/product";
const PAGE = 40; // server maximum
const MAX_PAGES = 40;
const PAUSE_MS = 400;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The whole catalogue, walked when the sale page is restricted. */
export const FALLBACK_KEY = "shop-all";
const MAX_FALLBACK_PAGES = 90;

export function pageUrl(country: CountryCode, page: number, urlKey?: string): string {
  const m = LOVEBONITO_MARKETS[country]!;
  return `${HOST}/api-2/es-catalog/catalog/getProducts?urlKey=${urlKey ?? m.saleKey}&count=${PAGE}&agg=false&page=${page}&storeCode=${m.storeCode}`;
}

/** A sale page hidden behind a teaser: real total, no hits. Pure. */
export function isRestricted(d: any): boolean {
  return d?.result?.isRestricted === true && !d?.result?.hits?.hits?.length;
}

const img = (p: unknown): string | null =>
  typeof p === "string" && p.startsWith("/") ? `${MEDIA}${p}` : typeof p === "string" && p.startsWith("http") ? p : null;

/** Map one catalogue hit to zero or more product × colour records. Pure. */
export function mapHit(src: any, country: CountryCode): ProductRecord[] {
  const m = LOVEBONITO_MARKETS[country];
  if (!m || !src?.sku || !src?.name || !src?.url_key) return [];
  const sizeLabel = new Map<string, string>();
  for (const o of src.configurable_options ?? []) {
    if (o?.attribute_code !== "size") continue;
    for (const v of o.values ?? []) sizeLabel.set(String(v.value_index), String(v.label));
  }
  const byColour = new Map<string, any[]>();
  for (const c of src.configurable_children ?? []) {
    const k = String(c?.color ?? "");
    byColour.set(k, [...(byColour.get(k) ?? []), c]);
  }
  const out: ProductRecord[] = [];
  for (const [colour, kids] of byColour) {
    const reduced = kids.filter((c) => Number(c?.final_price) > 0 && Number(c.final_price) < Number(c?.regular_price));
    if (!reduced.length) continue;
    const inStock = (c: any) => c?.stock?.is_in_stock === true;
    const pick = [...reduced].sort(
      (a, b) => Number(inStock(b)) - Number(inStock(a)) || Number(a.final_price) - Number(b.final_price),
    )[0];
    const price = Number(pick.final_price);
    const was = Number(pick.regular_price);
    const gallery = [pick.image, ...((pick.media_gallery ?? []) as any[]).map((g) => g?.image)].map(img);
    const first = gallery.find(Boolean) ?? img(src.image);
    const sizes: SizeVariant[] = kids
      .map((c) => ({
        label: sizeLabel.get(String(c?.size)) ?? "",
        availability: (inStock(c) ? "in_stock" : "out_of_stock") as SizeVariant["availability"],
      }))
      .filter((s) => s.label);
    out.push({
      brand,
      country,
      externalId: `${src.sku}-${colour}`,
      name: String(src.name).trim(),
      url: `${HOST}/${m.path}/${src.url_key}.html`,
      imageUrl: first,
      images: cleanGallery(gallery, first),
      price: toMinor(price),
      listPrice: toMinor(was),
      currency: COUNTRIES[country].currency,
      inStock: kids.some(inStock),
      category: null,
      gender: "kadin",
      variants: sizes.length ? { colors: [], sizes } : null,
      groupKey: `lovebonito:${src.sku}`,
      colorName: null,
    });
  }
  return out;
}

async function walk(country: CountryCode, urlKey: string | undefined, maxPages: number, byId: Map<string, ProductRecord>): Promise<"ok" | "restricted"> {
  let total = Infinity;
  for (let page = 1; (page - 1) * PAGE < total; page++) {
    if (page > maxPages) throw new Error(`lovebonito/${country}: ${total} products, over ${maxPages} pages`);
    if (page > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(pageUrl(country, page, urlKey), { country });
    if (page === 1 && !urlKey && isRestricted(d)) return "restricted";
    const hits: any[] | undefined = d?.result?.hits?.hits;
    if (!Array.isArray(hits)) throw new Error(`lovebonito/${country}: malformed page ${page}`);
    total = Number(d.result.hits.total?.value ?? 0);
    for (const h of hits) for (const r of mapHit(h?._source, country)) byId.set(r.externalId, r);
    if (!hits.length) break;
  }
  return "ok";
}

export async function listLoveBonito(country: CountryCode): Promise<ProductRecord[]> {
  if (!LOVEBONITO_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  if ((await walk(country, undefined, MAX_PAGES, byId)) === "restricted") {
    console.log(`lovebonito/${country}: sale page restricted, walking ${FALLBACK_KEY}`);
    await walk(country, FALLBACK_KEY, MAX_FALLBACK_PAGES, byId);
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
