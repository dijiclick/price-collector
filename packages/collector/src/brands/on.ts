/**
 * On (on.com) — US, Switzerland, GB, the EU shops, AU, JP and HK, through the Algolia index on.com's own
 * product grids query (`algolia.on.com`, a first-party CNAME, with the public
 * search-only key the site ships). On has no sale URL of its own; every record
 * carries per-store pricing (`stores.us.price`, `basePrice`,
 * `discountPercentage`) and the index filters on it, so "discounted, visible in
 * this store" is one filter.
 *
 * A record is one colourway (objectID = colour sku). Its `stores.<cc>` block
 * lists which colour skus of the style are discounted; a colourway is kept
 * only when it is itself in `discountedSkus`, so a style with one reduced
 * colour does not drag its full-price siblings in.
 *
 * Algolia caps any query at 1,000 hits (`paginationLimitedTo`), and the sale
 * runs ~1,100-1,200 colourways per store (2026-10-11), so the sweep is split by
 * the `gender` attribute (womens/mens/unisex, each well under 1,000): three
 * requests per market.
 *
 * Sizes: `productsAvailableSizes[colourSku]` lists the sizes currently
 * buyable, so they are reported in stock; sold-out sizes are not in the record.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const APP_ID = "ML35QLWPOC";
/** Public, search-only key from on.com's page (the same one every visitor's browser sends). */
const SEARCH_KEY = "bff229776989d153121333c90db826b1";
const HOST = "https://algolia.on.com";

export const ON_MARKETS: Partial<Record<CountryCode, { index: string; store: string; site: string }>> = {
  US: { index: "US_products_production_v3", store: "us", site: "https://www.on.com/en-us" },
  CH: { index: "CH_products_production_v3", store: "ch", site: "https://www.on.com/de-ch" },
  // 2026-10-21: Britain has its own index; the EU shops share one index with a
  // `stores.<cc>` block per country (prices in that country's currency — SEK,
  // DKK); Australia, Japan and Hong Kong have their own. All answered a runner
  // (probe 39653951827). Site prefixes are the ones on.com itself answers 200
  // (nl-nl, fi-fi, sv-se, da-dk redirect to en-*).
  GB: { index: "UK_products_production_v3", store: "gb", site: "https://www.on.com/en-gb" },
  DE: { index: "EU_products_production_v3", store: "de", site: "https://www.on.com/de-de" },
  FR: { index: "EU_products_production_v3", store: "fr", site: "https://www.on.com/fr-fr" },
  IT: { index: "EU_products_production_v3", store: "it", site: "https://www.on.com/it-it" },
  ES: { index: "EU_products_production_v3", store: "es", site: "https://www.on.com/es-es" },
  NL: { index: "EU_products_production_v3", store: "nl", site: "https://www.on.com/en-nl" },
  BE: { index: "EU_products_production_v3", store: "be", site: "https://www.on.com/fr-be" },
  AT: { index: "EU_products_production_v3", store: "at", site: "https://www.on.com/de-at" },
  IE: { index: "EU_products_production_v3", store: "ie", site: "https://www.on.com/en-ie" },
  PT: { index: "EU_products_production_v3", store: "pt", site: "https://www.on.com/pt-pt" },
  FI: { index: "EU_products_production_v3", store: "fi", site: "https://www.on.com/en-fi" },
  SE: { index: "EU_products_production_v3", store: "se", site: "https://www.on.com/en-se" },
  DK: { index: "EU_products_production_v3", store: "dk", site: "https://www.on.com/en-dk" },
  AU: { index: "AU_products_production_v3", store: "au", site: "https://www.on.com/en-au" },
  JP: { index: "JP_products_production_v3", store: "jp", site: "https://www.on.com/ja-jp" },
  HK: { index: "HK_products_production_v3", store: "hk", site: "https://www.on.com/en-hk" },
};

const SLICES = ["womens", "mens", "unisex"];
const PAUSE_MS = Number(process.env.ON_PAUSE_MS ?? 600);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ATTRS = [
  "objectID", "name", "colorName", "productType", "productSubtype", "gender", "ageGroup", "stores",
  "productsAvailableSizes", "productUrl", "imageUrl", "firstGalleryImageUrl", "onsiteImageUrl", "groupingKey", "styleID",
];

export function queryParams(store: string, slice: string | null): string {
  const filters = [`stores.${store}.isVisible:true`, `stores.${store}.discountPercentage > 0`];
  if (slice) filters.push(`gender:${slice}`);
  return new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    distinct: "false",
    filters: filters.join(" AND "),
    attributesToRetrieve: ATTRS.join(","),
  }).toString();
}

function genderOf(h: any): ProductRecord["gender"] {
  if (h?.ageGroup && h.ageGroup !== "adults") return "cocuk";
  if (h?.gender === "womens") return "kadin";
  if (h?.gender === "mens") return "erkek";
  return null;
}

/** Buyable sizes of this colourway, in record order. */
export function sizesOf(h: any): SizeVariant[] {
  const bySystem = h?.productsAvailableSizes?.[h?.objectID] ?? {};
  const seen = new Set<string>();
  const out: SizeVariant[] = [];
  for (const list of Object.values(bySystem)) {
    for (const s of Array.isArray(list) ? list : []) {
      const label = String(s).trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, availability: "in_stock" });
    }
  }
  return out;
}

/**
 * On's Contentful originals are 4000×4000 and 7-9 MB a photo (PNGs included);
 * Contentful resizes on request, so store a 1000px JPEG (8.8 MB → ~60 KB).
 * The app's photoAt() swaps `w` for the size it draws. Other hosts unchanged.
 */
export function sizedPhoto(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try {
    const url = new URL(u);
    if (url.hostname !== "images.ctfassets.net") return u;
    url.searchParams.set("w", "1000");
    url.searchParams.set("fm", "jpg");
    url.searchParams.set("q", "80");
    return url.toString();
  } catch {
    return u;
  }
}

export function mapOnHit(h: any, country: CountryCode): ProductRecord | null {
  const m = ON_MARKETS[country];
  const st = m && h?.stores?.[m.store];
  if (!m || !st || !h?.objectID) return null;
  if (!Array.isArray(st.discountedSkus) || !st.discountedSkus.includes(h.objectID)) return null;
  const price = Number(st.price);
  const base = Number(st.basePrice);
  if (!(price > 0) || !(base > price)) return null;
  const sizes = sizesOf(h);
  const img = sizedPhoto(h.imageUrl);
  const type = [h.productSubtype, h.productType].filter((x) => typeof x === "string" && x).join(" ").replace(/_/g, " ");
  return {
    brand: "on",
    country,
    externalId: String(h.objectID),
    name: String(h.name ?? "").trim(),
    url: `${m.site}${h.productUrl ?? ""}`,
    imageUrl: img,
    images: cleanGallery([img, sizedPhoto(h.firstGalleryImageUrl), sizedPhoto(h.onsiteImageUrl)], img),
    price: toMinor(price),
    listPrice: toMinor(base),
    currency: COUNTRIES[country].currency,
    inStock: st.canBePurchased === true && (sizes.length > 0 || !h.productsAvailableSizes),
    category: type || null,
    gender: genderOf(h),
    variants: sizes.length || h.colorName ? { colors: h.colorName ? [String(h.colorName)] : [], sizes } : null,
    // Colourways of one style share the grouping key (the style's product path).
    groupKey: h.groupingKey ? `on:${h.groupingKey}` : null,
    colorName: h.colorName ?? null,
  };
}

export async function listOn(country: CountryCode): Promise<ProductRecord[]> {
  const m = ON_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let ok = 0;
  for (const [i, slice] of SLICES.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(`${HOST}/1/indexes/${m.index}/query`, {
      method: "POST",
      country,
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": APP_ID,
        "X-Algolia-API-Key": SEARCH_KEY,
        Referer: "https://www.on.com/",
      },
      body: JSON.stringify({ params: queryParams(m.store, slice) }),
    }).catch(() => null);
    if (!data) continue;
    ok++;
    for (const h of data.hits ?? []) {
      const r = mapOnHit(h, country);
      if (r) byId.set(r.externalId, r);
    }
  }
  if (ok === 0) throw new Error(`on/${country}: Algolia refused every query`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const brand = "on";
export const listProducts = listOn;
