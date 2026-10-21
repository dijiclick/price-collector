/**
 * US/Canada SFCC stores whose product grid comes from the Algolia SFCC
 * cartridge — Shoe Carnival, Vineyard Vines and HEYDUDE. Each storefront ships
 * a public, search-only key in its page config; Algolia answers a plain POST
 * from a GitHub runner whatever the storefront's own bot wall does (HEYDUDE's
 * heydude.ca is a Cloudflare challenge, the index is not). Measured 2026-10-21.
 *
 * - Shoe Carnival (`FA677J9QJI`): one hit per style colour, `price` holds
 *   `c_standard_price` (struck) and `c_sale_price` (paid). `on_sale:true` is
 *   ~40% of the catalogue (11.1k of 27.4k), so the markdowns are real. A
 *   multi-brand store: the maker is kept. BOGO promotions are ignored.
 * - Vineyard Vines (`8LOVRZPPS0`): `listPrice` / `salePrice` per colour; ~17%
 *   of the catalogue carries a sale price. Rows not `orderable` and the
 *   "Home, Pet, Promo" department are dropped.
 * - HEYDUDE (`7DG8T3L1VE`, the Crocs group's stack — see crocs.ts): `pricing`
 *   `{ price, regularPrice }`; a hit whose own `price[<currency>]` differs from
 *   `pricing.price` is a range over sizes and is dropped, as Crocs does.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type AlgoliaUscaBrand = "shoecarnival" | "vineyardvines" | "heydude";

interface Market {
  host: string;
  index: string;
}

interface Site {
  appId: string;
  /** Public search-only key from the storefront config. */
  key: string;
  markets: Partial<Record<CountryCode, Market>>;
  filters: string;
  numericFilters?: string[];
  /**
   * Algolia stops paging at 1,000 hits per query, so a big sale is read in
   * slices (an extra filter each), every slice with its own share of the cap.
   */
  slices?: { filter: string; max: number }[];
  attrs: string[];
  cap: number;
}

export const ALGOLIA_USCA: Record<AlgoliaUscaBrand, Site> = {
  shoecarnival: {
    appId: "FA677J9QJI",
    key: "23d75c51c43c0ea2995b94bd56048224",
    markets: {
      US: { host: "https://www.shoecarnival.com", index: "production_na02_shoecarnival_demandware_net__shoecarnival__products__default" },
    },
    filters: "on_sale:true AND in_stock:true AND online:true AND NOT isGiftCard:true",
    slices: [
      { filter: 'gender:"Women"', max: 700 },
      { filter: 'gender:"Men"', max: 400 },
      { filter: '(gender:"Girls" OR gender:"Boys")', max: 400 },
    ],
    attrs: ["objectID", "name", "url", "brand", "price", "gender", "color", "colorId", "masterStyle", "image_groups", "__primary_category", "in_stock", "isGiftCard"],
    cap: 1500,
  },
  vineyardvines: {
    appId: "8LOVRZPPS0",
    key: "419b4eb230d6850d8e47a649fbcbec1e",
    markets: {
      US: { host: "https://www.vineyardvines.com", index: "production_web_vineyardvines_demandware_net__Vineyard-Vines__products__default" },
    },
    filters: "orderable:true",
    numericFilters: ["salePrice>0"],
    attrs: ["objectID", "name", "c_pdpURL", "price", "listPrice", "salePrice", "orderable", "item_department", "Refine_Class", "colorName", "Style_ID", "image_groups"],
    cap: 1500,
  },
  heydude: {
    appId: "7DG8T3L1VE",
    key: "ac4ba507e171eaeaaefd580ff728c7d5",
    markets: {
      US: { host: "https://www.heydude.com", index: "production_heydude_us__products__default" },
      CA: { host: "https://www.heydude.ca", index: "production_heydude_ca__products__en_CA" },
    },
    filters: "pricing.onSale:true",
    attrs: ["objectID", "master", "name", "url", "image", "altImage", "pricing", "price", "gender", "lifestyle", "color", "hideFromSearch"],
    cap: 1500,
  },
};

const PAGE = 1000;
const MAX_PAGES = 3;
const PAUSE_MS = Number(process.env.ALGOLIA_USCA_PAUSE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

function genderOf(v: unknown): ProductRecord["gender"] {
  const s = String(Array.isArray(v) ? v.join(" ") : v ?? "").toLowerCase();
  const women = /\bwom[ae]n|\bwomens\b/.test(s);
  const men = /(^|[^o])\bm[ae]n\b|\bmens\b/.test(s);
  const kids = /\b(girls?|boys?|kids?|toddler|infant|youth)\b/.test(s);
  if (kids && !women && !men) return "cocuk";
  if (women && !men) return "kadin";
  if (men && !women) return "erkek";
  return null;
}

/** `image_groups` arrives as an array, or as a JSON string (Vineyard Vines). */
function groupImages(raw: unknown): string[] {
  let groups: any = raw;
  if (typeof raw === "string") {
    try {
      groups = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(groups)) return [];
  const g = groups.find((x: any) => /hi-res|large/i.test(String(x?.view_type ?? ""))) ?? groups[0];
  return (g?.images ?? []).map((i: any) => i?.dis_base_link).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"));
}

/** One hit → record (real markdowns only). Pure. */
export function mapAlgoliaUscaHit(brand: AlgoliaUscaBrand, hit: any, country: CountryCode): ProductRecord | null {
  const m = ALGOLIA_USCA[brand].markets[country];
  if (!m || !hit?.objectID || !hit?.name) return null;
  const currency = COUNTRIES[country].currency;
  let now = NaN;
  let was = NaN;
  let path = "";
  let imgs: string[] = [];
  let gender: ProductRecord["gender"] = null;
  let category: string | null = null;
  let maker: string | null = null;
  let colorName: string | null = null;
  let groupKey: string | null = null;
  let inStock = true;

  if (brand === "shoecarnival") {
    if (hit.isGiftCard) return null;
    now = money(hit.price?.c_sale_price);
    was = money(hit.price?.c_standard_price);
    path = String(hit.url ?? "");
    imgs = groupImages(hit.image_groups);
    gender = genderOf(hit.gender);
    const pc = hit.__primary_category ?? {};
    category = String(pc["2"] ?? pc["1"] ?? pc["0"] ?? "").replace(/\s*>\s*/g, " / ") || null;
    maker = typeof hit.brand === "string" && hit.brand.trim() ? hit.brand.trim() : null;
    colorName = typeof hit.color === "string" ? hit.color : null;
    groupKey = hit.masterStyle ? `shoecarnival:${hit.masterStyle}` : null;
    inStock = hit.in_stock !== false;
  } else if (brand === "vineyardvines") {
    const dept = String(hit.item_department ?? "");
    if (!/^(mens|womens|boys|girls)$/i.test(dept)) return null;
    if (hit.orderable === false) return null;
    now = money(hit.salePrice);
    was = money(hit.listPrice);
    // The colour's own price must be the sale price, or the sale is on another colour/size.
    const own = money(hit.price?.[currency]);
    if (Number.isFinite(own) && Math.abs(own - now) >= 0.005) return null;
    path = String(hit.c_pdpURL ?? "");
    // A few rows point at the staging image host; the production one serves the same file.
    imgs = groupImages(hit.image_groups).map((u) =>
      u.replace("://stage.vineyardvines.com/dw/image/v2/AAHW_STG/", "://www.vineyardvines.com/dw/image/v2/AAHW_PRD/"),
    );
    gender = genderOf(dept);
    category = typeof hit.Refine_Class === "string" ? hit.Refine_Class : null;
    colorName = typeof hit.colorName === "string" ? hit.colorName : null;
    groupKey = hit.Style_ID ? `vineyardvines:${hit.Style_ID}` : null;
  } else {
    if (hit.hideFromSearch === true) return null;
    const p = hit.pricing ?? {};
    now = money(p.price);
    was = money(p.regularPrice);
    const own = money(hit.price?.[currency]);
    if (!(Math.abs(own - now) < 0.005)) return null;
    path = String(hit.url ?? "");
    imgs = [hit.image, hit.altImage].filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"));
    gender = genderOf(hit.gender);
    category = Array.isArray(hit.lifestyle) && hit.lifestyle.length ? String(hit.lifestyle[0]) : null;
    colorName = hit.color?.name ? String(hit.color.name) : null;
    groupKey = hit.master ? `heydude:${hit.master}` : null;
  }

  if (!(now > 0) || !(was > now) || !path) return null;
  const url = /^https?:/.test(path) ? path : `${m.host}${path.startsWith("/") ? "" : "/"}${path}`;
  return {
    brand,
    country,
    externalId: String(hit.objectID),
    name: String(hit.name).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: toMinor(was),
    currency,
    inStock,
    category,
    maker,
    gender,
    variants: null,
    groupKey,
    colorName,
  };
}

export function algoliaUscaBody(brand: AlgoliaUscaBrand, page: number, slice?: string): string {
  const s = ALGOLIA_USCA[brand];
  return JSON.stringify({
    query: "",
    page,
    hitsPerPage: PAGE,
    filters: slice ? `${s.filters} AND ${slice}` : s.filters,
    ...(s.numericFilters ? { numericFilters: s.numericFilters } : {}),
    attributesToRetrieve: s.attrs,
    attributesToHighlight: [],
  });
}

/** Register as `listAlgoliaUsca("shoecarnival" | "vineyardvines" | "heydude", country)`. */
export async function listAlgoliaUsca(brand: AlgoliaUscaBrand, country: CountryCode): Promise<ProductRecord[]> {
  const s = ALGOLIA_USCA[brand];
  const m = s.markets[country];
  if (!m) return [];
  const url = `https://${s.appId}-dsn.algolia.net/1/indexes/${m.index}/query`;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const slice of s.slices ?? [{ filter: "", max: s.cap }]) {
    let taken = 0;
    let nbPages = 1;
    for (let page = 0; page < Math.min(MAX_PAGES, nbPages) && taken < slice.max && byId.size < s.cap; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const res = await getJson<any>(url, {
        country,
        method: "POST",
        headers: { "X-Algolia-Application-Id": s.appId, "X-Algolia-API-Key": s.key, "Content-Type": "application/json" },
        body: algoliaUscaBody(brand, page, slice.filter || undefined),
      });
      if (!Array.isArray(res?.hits)) throw new Error(`${brand}/${country}: Algolia page ${page} has no hits array`);
      nbPages = Number(res.nbPages ?? 0);
      for (const h of res.hits) {
        if (taken >= slice.max || byId.size >= s.cap) break;
        const r = mapAlgoliaUscaHit(brand, h, country);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          taken++;
        }
      }
    }
  }
  if (!byId.size) throw new Error(`${brand}/${country}: no discounted rows in the Algolia index`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, s.cap);
}
