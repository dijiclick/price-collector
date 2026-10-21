/**
 * Chico's FAS (Knitwell group) — Chico's (chicos.com) and White House Black
 * Market (whitehouseblackmarket.com), US. Both are Next.js storefronts whose
 * listing pages are filled from Algolia; the public search-only key and the
 * index name ship in every page's RSC payload (`algoliaVars`, `indexName`),
 * read 2026-10-21. Each brand has its own Algolia app.
 *
 * One hit per colour (the index de-duplicates by `Parent_Sku`), with:
 *   PRICE         the full price the site strikes through;
 *   SALE_PRICE    the store's own marked-down price;
 *   PRICE_STATUS  FP (full price), FP_POS (full price under a temporary
 *                 till promotion), M1/M2/ML (markdowns), OS (outlet/final sale);
 *   HAS_INVENTORY this colour has stock online.
 * Only markdown statuses (M1/M2/ML/OS) with SALE_PRICE < PRICE are kept. The
 * near-permanent "30% Off. Price as Marked." till promotions on full-price
 * styles (FP_POS) and multi-buys ("Buy 3 for $59") are not markdowns and are
 * left out, and the record shows SALE_PRICE, never a further promo price.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export type ChicosBrand = "chicos" | "whitehouseblackmarket";

interface ChicosSite {
  host: string;
  appId: string;
  key: string;
  index: string;
}

/** Public search-only keys from the storefronts' page payloads (2026-10-21). */
export const CHICOS_SITES: Record<ChicosBrand, ChicosSite> = {
  chicos: { host: "https://www.chicos.com", appId: "8OSS1VENX5", key: "0f7c1476b9d2ccfd469e8a1db6dbc8fa", index: "prod_chs_products" },
  whitehouseblackmarket: {
    host: "https://www.whitehouseblackmarket.com",
    appId: "R7XH6HY890",
    key: "66576acefa5a819120f76b593743a2a4",
    index: "prod_whbm_products",
  },
};

const MARKDOWN = "(PRICE_STATUS:M1 OR PRICE_STATUS:M2 OR PRICE_STATUS:ML OR PRICE_STATUS:OS)";
const PER_PAGE = 1000;
const MAX_REQUESTS = 10;
const CAP = 1500;
const PAUSE_MS = Number(process.env.CHICOS_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEPARTMENTS = /^(clothing|accessories|shoes|jewelry|intimates|swim)$/i;

const ATTRS = [
  "STYLE_ID", "TITLE", "PRICE", "SALE_PRICE", "PRICE_STATUS", "HAS_INVENTORY", "COLOR_NAME", "COLOR_CODE",
  "PRODUCT_URL_RELATIVE", "MAIN_IMAGE_URL", "ALT_IMAGES", "CATALOG_TYPE", "GENDER", "CURRENCY", "Parent_Sku",
];

/** "/category/Blouses+&+Shirts/cat11199294" list → the shelf after the department, "Blouses & Shirts". Pure. */
export function chicosCategory(paths: unknown): string | null {
  const names = (Array.isArray(paths) ? paths : [])
    .map((p) => String(p).split("/")[2] ?? "")
    .map((s) => {
      const t = s.replace(/\+/g, " ");
      try {
        return decodeURIComponent(t).trim();
      } catch {
        return t.trim(); // "40%+Off" is not valid percent-encoding
      }
    });
  const i = names.findIndex((n) => DEPARTMENTS.test(n));
  const next = i >= 0 ? names[i + 1] : undefined;
  return next && !/sale|new|best|exclusive|\$/i.test(next) ? next : i >= 0 ? names[i] : null;
}

/** One Algolia hit → a record, or null when it is not a real markdown. Pure. */
export function mapChicos(brand: ChicosBrand, h: any, country: CountryCode = "US"): ProductRecord | null {
  const site = CHICOS_SITES[brand];
  const price = Number(h?.SALE_PRICE);
  const was = Number(h?.PRICE);
  if (!/^(M1|M2|ML|OS)$/.test(String(h?.PRICE_STATUS ?? ""))) return null;
  if (!h?.STYLE_ID || !h?.TITLE || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  if (h.CURRENCY && h.CURRENCY !== "USD") return null;
  const colourCode = String(h.COLOR_CODE ?? "").trim();
  const path = String(h.PRODUCT_URL_RELATIVE ?? "/store/product/p/").toLowerCase().replace(/\/?$/, "/");
  const photos = [h.MAIN_IMAGE_URL, ...String(h.ALT_IMAGES ?? "").split(",")].map((u) => (typeof u === "string" ? u.trim() : ""));
  const images = cleanGallery(photos);
  const colour = typeof h.COLOR_NAME === "string" ? h.COLOR_NAME.trim() : "";
  const g = String(h.GENDER ?? "").toLowerCase();
  return {
    brand,
    country,
    externalId: String(h.Parent_Sku ?? `${h.STYLE_ID}_${colourCode}`),
    name: String(h.TITLE).replace(/\s+/g, " ").trim(),
    url: `${site.host}${path}${h.STYLE_ID}${colourCode ? `?color=${colourCode}` : ""}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: h.HAS_INVENTORY === true,
    category: chicosCategory(h.CATALOG_TYPE),
    gender: g === "men" ? "erkek" : "kadin",
    variants: null,
    groupKey: `${brand}:${h.STYLE_ID}`,
    colorName: colour || null,
  };
}

/** Register as `listChicosFas("chicos" | "whitehouseblackmarket", country)`. US only. */
export async function listChicosFas(brand: ChicosBrand, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const site = CHICOS_SITES[brand];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  // In-stock colours first, then sold-out ones to fill the cap.
  for (const stock of ["HAS_INVENTORY:true", "HAS_INVENTORY:false"]) {
    for (let page = 0; byId.size < CAP; page++) {
      if (requests >= MAX_REQUESTS) throw new Error(`${brand}/${country}: request budget spent before the markdown list ended`);
      if (requests++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(`https://${site.appId}-dsn.algolia.net/1/indexes/${site.index}/query`, {
        method: "POST",
        country,
        headers: { "X-Algolia-Application-Id": site.appId, "X-Algolia-API-Key": site.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "",
          page,
          hitsPerPage: PER_PAGE,
          filters: `${MARKDOWN} AND ${stock}`,
          attributesToRetrieve: ATTRS,
          attributesToHighlight: [],
        }),
      });
      const hits: any[] = data?.hits;
      if (!Array.isArray(hits)) throw new Error(`${brand}/${country}: Algolia page ${page} returned no hits array`);
      for (const h of hits) {
        const r = mapChicos(brand, h, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (page + 1 >= Number(data.nbPages ?? 0) || hits.length < PER_PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
