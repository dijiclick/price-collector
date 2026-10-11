/**
 * lululemon (US + Canada): the "We Made Too Much" markdown section, read
 * through the storefront's own GraphQL (`shop.lululemon.com/snb/graphql`,
 * operation `CategoryPageDataQuery` — the query the category page runs).
 *
 * shop.lululemon.com sits behind Akamai Bot Manager. Every HTML page, the
 * sitemap and the static bundles answer 403 to a plain client (GitHub runner,
 * probe 38129294052), and a browser User-Agent on the GraphQL route gets
 * `400 GE401001`. The route is let through for the shopping APP's User-Agent,
 * which is what this adapter sends — measured 2026-10-11 from a Turkish home
 * line and through US and CA residential exits. It is POST-only, so the GET
 * probe cannot prove it from a runner; `proxy: true` therefore keeps the
 * residential exit as a FALLBACK only (http.ts: direct first, proxy on retry).
 *
 * WMTM is fetched per gender (women's, then men's), 40 per page — ~32 requests
 * for the US, ~24 for Canada. A product in both lists (bags, bottles) is unisex.
 * The listing carries a price range per product, not per colour, and the sizes
 * that are still available (no sold-out sizes), so sizes are all `in_stock`.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "lululemon";

const API = "https://shop.lululemon.com/snb/graphql";
/** The iOS app's UA: Akamai passes it to the GraphQL origin; a browser UA is refused. */
const APP_UA = "lululemon/7.30.0 (com.lululemon.shopapp; build:1; iOS 18.5.0) Alamofire/5.9.1";
/**
 * 40 is the storefront's own page size, and the largest that is safe: above
 * ~45 the API truncates `allAvailableSizes` (at 50 the first product lists one
 * size instead of six). Measured 2026-10-11; 40-, 30- and 25-product pages all
 * matched 5-product pages size for size.
 */
const PAGE_SIZE = 40;
const MAX_PAGES = 25; // per gender; WMTM is ~830 women's (21 pages) + ~410 men's (11) in the US
const PAUSE_MS = 700;
const CAP = 1500;

export const LULULEMON_MARKETS: Partial<Record<CountryCode, { sl: string; locale: string; site: string }>> = {
  US: { sl: "US", locale: "en_US", site: "https://shop.lululemon.com" },
  CA: { sl: "CA", locale: "en_CA", site: "https://shop.lululemon.com/en-ca" },
};

/** WMTM section ids (`/c/<category>/<cdpHash>`), the same in both markets. */
const SECTIONS: { category: string; cdpHash: string; gender: "kadin" | "erkek" }[] = [
  { category: "women-we-made-too-much", cdpHash: "n16o10z8mhd", gender: "kadin" },
  { category: "men-we-made-too-much", cdpHash: "n18mhdznrqw", gender: "erkek" },
];

export const QUERY = `query CategoryPageDataQuery($category: String!, $cdpHash: String, $sl: String!, $locale: String!, $page: Int, $pageSize: Int, $forceMemberCheck: Boolean, $nValue: String, $Ns: String, $storeId: String, $onlyStore: Boolean, $useHighlights: Boolean, $abFlags: [String], $styleboost: [String], $fusionExperimentVariant: String, $cid: String) {
  categoryPageData(category: $category, nValue: $nValue, cdpHash: $cdpHash, locale: $locale, sl: $sl, Ns: $Ns, page: $page, pageSize: $pageSize, storeId: $storeId, onlyStore: $onlyStore, forceMemberCheck: $forceMemberCheck, cid: $cid, useHighlights: $useHighlights, abFlags: $abFlags, styleboost: $styleboost, fusionExperimentVariant: $fusionExperimentVariant) {
    totalProductPages currentPage isWMTM
    products { productId displayName listPrice salePrice onSale currencyCode pdpUrl allAvailableSizes parentCategoryUnifiedId skuStyleOrder { colorName styleId images } }
  }
}`;

export function requestBody(country: CountryCode, category: string, cdpHash: string, page: number): string {
  const m = LULULEMON_MARKETS[country]!;
  return JSON.stringify({
    operationName: "CategoryPageDataQuery",
    query: QUERY,
    variables: {
      category, cdpHash, sl: m.sl, locale: m.locale, page, pageSize: PAGE_SIZE,
      forceMemberCheck: false, nValue: null, Ns: "price|1", storeId: null, onlyStore: false,
      useHighlights: true, abFlags: ["cdpSeodsEnabled"], styleboost: [], fusionExperimentVariant: "", cid: "",
    },
  });
}

const nums = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [v]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);

const LETTERS = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "1X", "2X", "3X"];
function sizeRank(s: string): number {
  const u = s.toUpperCase();
  const i = LETTERS.indexOf(u);
  if (i >= 0) return 1000 + i;
  const n = parseFloat(u);
  return Number.isFinite(n) ? n : 5000;
}

/** Map one listing product. Pure; null unless it is genuinely reduced. */
export function mapLululemon(p: any, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const m = LULULEMON_MARKETS[country];
  if (!m || !p?.productId || !p?.displayName || !p?.pdpUrl) return null;
  const sale = nums(p.salePrice);
  const list = nums(p.listPrice);
  if (!sale.length || !list.length) return null;
  // A range on both sides ("$64–$99" off "$148") is per colour; pair the lowest
  // sale with the LOWEST list so a range can never inflate the discount.
  const price = Math.min(...sale);
  const was = Math.min(...list);
  if (!(price < was)) return null;

  const labels = [...new Set<string>((p.allAvailableSizes ?? []).map((s: unknown) => String(s).trim()).filter(Boolean))];
  labels.sort((a, b) => sizeRank(a) - sizeRank(b));
  const sizes: SizeVariant[] = labels.map((label) => ({ label, availability: "in_stock" }));
  const styles: any[] = Array.isArray(p.skuStyleOrder) ? p.skuStyleOrder : [];
  const colors = [...new Set(styles.map((s) => String(s?.colorName ?? "").trim()).filter(Boolean))];
  const photos: string[] = (styles[0]?.images ?? []).filter((u: unknown): u is string => typeof u === "string");
  const path = String(p.pdpUrl).replace(/^\/en-ca(?=\/)/, "");
  const type = typeof p.parentCategoryUnifiedId === "string" ? p.parentCategoryUnifiedId.replace(/-/g, " ").trim() : "";

  return {
    brand,
    country,
    externalId: String(p.productId),
    name: String(p.displayName).trim(),
    url: `${m.site}${path}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: COUNTRIES[country].currency,
    inStock: sizes.length > 0,
    category: type || null,
    gender,
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

async function page(country: CountryCode, category: string, cdpHash: string, n: number): Promise<any> {
  const data = await getJson<any>(API, {
    method: "POST",
    body: requestBody(country, category, cdpHash, n),
    headers: { "User-Agent": APP_UA, "Content-Type": "application/json" },
    country,
    proxy: true,
  });
  const c = data?.data?.categoryPageData;
  if (!c) throw new Error(`lululemon/${country}: ${JSON.stringify(data?.errors ?? data).slice(0, 200)}`);
  return c;
}

export async function listLululemon(country: CountryCode): Promise<ProductRecord[]> {
  if (!LULULEMON_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  for (const s of SECTIONS) {
    for (let n = 1; n <= MAX_PAGES; n++) {
      if (!first) await new Promise((r) => setTimeout(r, PAUSE_MS));
      first = false;
      const c = await page(country, s.category, s.cdpHash, n);
      for (const p of c.products ?? []) {
        const r = mapLululemon(p, country, s.gender);
        if (!r) continue;
        const prev = byId.get(r.externalId);
        byId.set(r.externalId, prev && prev.gender !== r.gender ? { ...r, gender: null } : r);
      }
      if (n >= Number(c.totalProductPages ?? 1)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listLululemon;
