/**
 * Harry Rosen (harryrosen.com) — Canada only. The country's luxury menswear
 * store: Canali, Brunello Cucinelli, Kiton, BOSS, Polo Ralph Lauren, Tumi...
 *
 * The storefront (Next.js on commercetools) lists from Algolia; the app id and
 * the public search-only key sit in its JS bundle (`appId:"CDROBE4GID"`). The
 * sale page (/en/shop/sale) is the index `styles_connector_production_consumer`
 * under the filter in SALE_FILTER — copied from the page's own request, 2,416
 * styles on 2026-11-10. Algolia answers a GitHub runner directly, no proxy
 * (probe run 42799158188).
 *
 * One hit is one colour of one style. `attributes.onlineSalePrice` is the
 * price charged online and `attributes.originalPrice` (commercetools money,
 * CAD cents) the struck one — the pair the product page shows. `onlineSizes`
 * lists the sizes buyable online, so they are reported in stock.
 *
 * Algolia stops at 1,000 hits a query, so the sale is read per department
 * (Clothing is split by its biggest shelves). Menswear only: every row is
 * `erkek`. Multi-brand: the designer goes to `maker`.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "harryrosen";

const APP_ID = "CDROBE4GID";
/** Public, search-only key from harryrosen.com's bundle (the one every visitor's browser sends). */
const SEARCH_KEY = "d95150eee0278896aedb31f5e8f80b0f";
const INDEX = "styles_connector_production_consumer";
const SITE = "https://www.harryrosen.com";
const CAP = 2500;
const PAUSE_MS = Number(process.env.HARRYROSEN_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sale page's own filter (brandId 1 = Harry Rosen, not the outlet banner). */
export const SALE_FILTER =
  'attributes.isOnlineAvailableToSell:"true" AND attributes.webStatus:"true" AND attributes.is997:"false" AND attributes.brandId:"1" AND attributes.isOnlineSale:"true"';

const L1 = "attributes.level1Category.en-CA";
const L3 = "attributes.level3Category.en-CA";
const TOPS = ["Casual Shirts", "Dress Shirts", "Polos", "T-Shirts", "Sweaters & Knits"];
/** Slices of the sale, each under Algolia's 1,000-hit ceiling (Clothing was 1,841 on 2026-11-10). */
export const SLICES: { label: string; filter: string }[] = [
  { label: "clothing: shirts and knits", filter: `${L1}:"Clothing" AND (${TOPS.map((t) => `${L3}:"${t}"`).join(" OR ")})` },
  { label: "clothing: the rest", filter: `${L1}:"Clothing" AND ${TOPS.map((t) => `NOT ${L3}:"${t}"`).join(" AND ")}` },
  { label: "footwear", filter: `${L1}:"Footwear"` },
  { label: "accessories", filter: `${L1}:"Accessories"` },
];

const ATTRS = [
  "objectID", "slug", "name",
  "attributes.brandName", "attributes.colour", "attributes.image", "attributes.imageZoom", "attributes.onlineSalePrice",
  "attributes.currentPrice", "attributes.originalPrice", "attributes.onlineSizes", "attributes.level3Category",
  "attributes.style", "attributes.isOnlineAvailableToSell",
];

export function queryParams(slice: string): string {
  return new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    filters: `${SALE_FILTER} AND ${slice}`,
    attributesToRetrieve: ATTRS.join(","),
    attributesToHighlight: "",
  }).toString();
}

const en = (v: any): string => String((v && typeof v === "object" ? v["en-CA"] ?? v.en : v) ?? "").trim();

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Sizes buyable online, in record order. */
export function sizesOf(a: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const group of Array.isArray(a?.onlineSizes) ? a.onlineSizes : []) {
    for (const v of Array.isArray(group?.value) ? group.value : []) {
      const label = en(v);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, availability: "in_stock" });
    }
  }
  return out;
}

/** Map one Algolia hit (one colour). Pure; null unless genuinely reduced, in CAD. */
export function mapHarryRosen(h: any): ProductRecord | null {
  const a = h?.attributes ?? {};
  const id = en(h?.slug) || String(h?.objectID ?? "");
  const title = en(h?.name);
  if (!id || !title) return null;
  const orig = a.originalPrice;
  if (!orig || orig.currencyCode !== "CAD" || !(Number(orig.centAmount) > 0)) return null;
  const list = Math.round(Number(orig.centAmount) * 10 ** (2 - Number(orig.fractionDigits ?? 2)));
  const nowMajor = Number(a.onlineSalePrice ?? a.currentPrice);
  if (!(nowMajor > 0)) return null;
  const price = toMinor(nowMajor);
  if (!(price < list)) return null;
  const maker = en(a.brandName) || null;
  const sizes = sizesOf(a);
  const colour = en(a.colour) || null;
  const base = typeof a.imageZoom === "string" && a.imageZoom ? a.imageZoom : String(a.image ?? "").split("?")[0];
  const img = /^https:\/\//.test(base) ? `${base}?w=900` : null;
  return {
    brand,
    country: "CA",
    externalId: id,
    name: maker && !title.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${title}` : title,
    // The site redirects any "<text>-<id>" slug to the canonical one; this is the canonical shape.
    url: `${SITE}/en/product/${slugify(`${maker ?? ""} ${title}`)}-${id}`,
    imageUrl: img,
    images: cleanGallery([], img),
    price,
    listPrice: list,
    currency: "CAD",
    inStock: a.isOnlineAvailableToSell !== false && sizes.length > 0,
    category: en(a.level3Category) || en(a.style) || null,
    maker,
    gender: "erkek",
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: null,
    colorName: colour,
  };
}

export async function listHarryRosen(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let hits = 0;
  for (const [i, s] of SLICES.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
      method: "POST",
      country,
      headers: { "Content-Type": "application/json", "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": SEARCH_KEY },
      body: JSON.stringify({ params: queryParams(s.filter) }),
      retries: 1,
      timeoutMs: 45_000,
    });
    const list: any[] = Array.isArray(data?.hits) ? data.hits : [];
    hits += list.length;
    if (Number(data?.nbHits) > 1000) console.warn(`harryrosen: ${s.label} has ${data.nbHits} hits; first 1000 read`);
    for (const h of list) {
      const r = mapHarryRosen(h);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  if (hits === 0) throw new Error("harryrosen/CA: the sale index returned no hits");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listHarryRosen;
