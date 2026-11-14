/**
 * Level Shoes (levelshoes.com, Chalhoub) — the Gulf's luxury shoe, bag and
 * accessory store: Gucci, Prada, Jimmy Choo, Valentino Garavani, Givenchy,
 * Bottega Veneta, Golden Goose… UAE, Saudi Arabia, Kuwait and Qatar.
 *
 * Rejected in October for having no sale; measured again 2026-11-10: the
 * catalogue now carries a `sale` facet (women's shoes: 1,324 of ~7,700 reduced).
 *
 * Route: the storefront's own REST middleware, `api.levelshoes.com/catalog/
 * <cc>/en/products/urlPath/v1` — the call the web app makes for every listing
 * (found in its JS bundle as the `Get Product List` @rest query). It needs the
 * header `x-level-platform: Web`; without it every listing answers 404. No key,
 * no cookie. `sale=sale` is the site's own Sale filter, `count` ≤ 96.
 *
 * Each product has `rawSalePrice` (charged) and `rawOriginalPrice` (struck) in
 * the market's currency — the response names its `currency`, and a response in
 * another currency than the market's fails the run. `brandName` is the maker;
 * `action.url` is the product page on the market's own host
 * (en-saudi.levelshoes.com, en-kuwait…). The listing has no per-size stock.
 *
 * BETWEEN SALES (2026-11-14: `sale=sale` answers 0 products on every listing,
 * the facet is gone, `/sale` redirects to an empty `women/outlet.html`, and
 * 0 of 96 shoes carry a struck price) each section is topped up to its cap
 * with in-stock FULL-PRICE rows from the same listing without the filter
 * (`listPrice: null`), as Gullfunn and the Landmark shops do. Collecting
 * nothing would leave last sale's rows live at old prices and fail every run;
 * a full-price row that is later reduced is then a real drop.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "levelshoes";
const API = "https://api.levelshoes.com/catalog";
const PAGE = 96;
const PAUSE_MS = Number(process.env.LEVELSHOES_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const LEVEL_MARKETS: Partial<Record<CountryCode, string>> = { AE: "ae", SA: "sa", KW: "kw", QA: "qa" };

/** The site's own listings, each read with its Sale filter on, and their share of the feed. */
export const LEVEL_SECTIONS: { path: string; genderType: string; gender: ProductRecord["gender"]; cap: number }[] = [
  { path: "women/shoes.html", genderType: "women", gender: "kadin", cap: 900 },
  { path: "women/bags.html", genderType: "women", gender: "kadin", cap: 300 },
  { path: "women/accessories.html", genderType: "women", gender: "kadin", cap: 150 },
  { path: "men/shoes.html", genderType: "men", gender: "erkek", cap: 350 },
];

export function levelUrl(country: CountryCode, path: string, genderType: string, page: number, sale = true): string {
  const cc = LEVEL_MARKETS[country];
  return `${API}/${cc}/en/products/urlPath/v1?urlPath=${path}&groupID=&museTier=&page=${page}&count=${PAGE}&genderType=${genderType}${sale ? "&sale=sale" : ""}`;
}

/**
 * Map one listing product. Pure; null unless it is reduced — or, with
 * `fullPrice`, an in-stock row at its shelf price (`listPrice: null`).
 */
export function mapLevel(p: any, country: CountryCode, gender: ProductRecord["gender"], fullPrice = false): ProductRecord | null {
  const url = p?.action?.url;
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  const price = Number(p?.rawSalePrice);
  const list = Number(p?.rawOriginalPrice);
  if (!p?.id || !name || typeof url !== "string" || !/^https:\/\/[a-z0-9-]+\.levelshoes\.com\//.test(url)) return null;
  if (!(price > 0) || p.isNonPurchasable === true) return null;
  const reduced = list > price;
  if (!reduced && (!fullPrice || p.isInStock === false)) return null;
  const imgs: string[] = (Array.isArray(p.imagePreviewGallery) ? p.imagePreviewGallery : [p.image])
    .map((i: any) => i?.url)
    .filter((u: unknown): u is string => typeof u === "string");
  const maker = typeof p.brandName === "string" && p.brandName.trim() ? p.brandName.trim() : null;
  const a = p.analytics ?? {};
  const g = String(a.gender ?? "").toLowerCase();
  return {
    brand,
    country,
    externalId: String(p.id),
    name,
    url,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: reduced ? toMinor(list) : null,
    currency: COUNTRIES[country].currency,
    inStock: p.isInStock !== false,
    category: [a.category3, a.category2, a.category1].find((c) => typeof c === "string" && c.trim()) ?? null,
    maker,
    gender: /kid|girl|boy|baby/.test(g) ? "cocuk" : gender,
    variants: null,
    groupKey: a.productGroupID ? `${brand}:${a.productGroupID}` : null,
    colorName: typeof p.color === "string" && p.color.trim() ? p.color.trim() : null,
  };
}

export async function listLevelShoes(country: CountryCode): Promise<ProductRecord[]> {
  if (!LEVEL_MARKETS[country]) return [];
  const currency = COUNTRIES[country].currency;
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let seen = 0;
  /** Walk one section until `cap` new rows are kept; returns how many were kept. */
  const walk = async (s: (typeof LEVEL_SECTIONS)[number], sale: boolean, cap: number): Promise<number> => {
    let kept = 0;
    const pages = Math.ceil(cap / PAGE) + 1;
    for (let page = 0; page < pages && kept < cap; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(levelUrl(country, s.path, s.genderType, page, sale), {
        country, retries: 2, timeoutMs: 40_000, headers: { "x-level-platform": "Web", Accept: "application/json" },
      });
      const rows: any[] = Array.isArray(d?.products) ? d.products : [];
      if (rows.length && d.currency !== currency) throw new Error(`levelshoes/${country}: listing priced in ${d.currency}, not ${currency}`);
      seen += rows.length;
      for (const p of rows) {
        if (kept >= cap) break;
        const r = mapLevel(p, country, s.gender, !sale);
        if (!r || byId.has(r.externalId)) continue;
        byId.set(r.externalId, r);
        kept++;
      }
      if (rows.length < PAGE) break;
    }
    return kept;
  };
  for (const s of LEVEL_SECTIONS) {
    const kept = await walk(s, true, s.cap);
    // Between sales: top the section up with full-price rows (see the header).
    if (kept < s.cap) await walk(s, false, s.cap - kept);
  }
  if (!seen) throw new Error(`levelshoes/${country}: the listings returned no products`);
  const all = [...byId.values()];
  const sale = all.filter((r) => r.listPrice != null);
  const full = all.filter((r) => r.listPrice == null);
  return [...sale.filter((r) => r.inStock), ...full, ...sale.filter((r) => !r.inStock)];
}

export const listProducts = listLevelShoes;
