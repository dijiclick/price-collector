/**
 * Tory Burch (toryburch.com, US) through the storefront's own product API —
 * `/api/prod-r2/v12/categories/<id>/products?limit=&offset=` with the public
 * `x-api-key` the Next.js app ships in its page config (`apiHost`/`apiKey`).
 *
 * The site is behind Akamai. The API answers a GitHub runner with a desktop
 * browser UA (probe runs 39137094418 and 39137413533, 2026-10-18: 200) but
 * refuses an okhttp UA (403), so this adapter keeps the default browser UA.
 * The Hetzner box also answers it, should runner IPs ever be refused.
 *
 * Collected: the "Sale — View All" category (`sale-view-all`, ~700 styles,
 * ~960 marked-down colours). Each swatch (colour) carries its own
 * `price: { type, min, max }`. Only `type: "Sale"` is a markdown: `min` is the
 * price charged and `max` the original the PDP strikes through ("OldPrice",
 * verified on the Ella Tote PDP: $199 vs $260). `Single` is full price and
 * `Range` is a spread across colours/sizes, never a discount.
 *
 * Photos: the site's own image host (s7.toryburch.com) refuses okhttp — the
 * user agent of Android's image loader — so photos come from Scene7's public
 * host (s7d9.scene7.com/is/image/ToryBurch/<code>), which serves the same
 * renditions to any client.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.toryburch.com";
const API = `${SITE}/api/prod-r2/v12`;
const API_KEY = "yP6bAmceig0QmrXzGfx3IG867h5jKkAs";
const CATEGORY = "sale-view-all";
const PAGE = 200;
const MAX_PAGES = 8;
const CAP = 1500;
const PAUSE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const photo = (code: string) => `https://s7d9.scene7.com/is/image/ToryBurch/${encodeURIComponent(code)}?wid=1200&hei=1200&fmt=jpeg`;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** A swatch's markdown, or null when it is not on sale. */
export function markdownOf(price: any): { price: number; list: number } | null {
  if (price?.type !== "Sale") return null;
  const now = num(price.min);
  const was = num(price.max);
  return now != null && was != null && now < was ? { price: now, list: was } : null;
}

/**
 * Markets. Canada (2026-10-21): the same API with `site=ToryBurch_CA` prices
 * every swatch in CAD (`price.currency`), ~700 sale styles; PDPs live under
 * /en-ca/.
 */
export const TORY_MARKETS: Partial<Record<CountryCode, { site: string; locale: string }>> = {
  US: { site: "ToryBurch_US", locale: "en-us" },
  CA: { site: "ToryBurch_CA", locale: "en-ca" },
};

/** Map one product (a style) to its marked-down colours. Pure. */
export function mapToryProduct(p: any, country: CountryCode = "US"): ProductRecord[] {
  const loc = (TORY_MARKETS[country] ?? TORY_MARKETS.US!).locale;
  const id = String(p?.id ?? "");
  const name = String(p?.name ?? "").replace(/\s+/g, " ").trim();
  if (!id || !name) return [];
  const swatches: any[] = p?.swatches ?? [];
  const path = typeof p?.staticURL === "string" && p.staticURL ? p.staticURL.replace(/^\/+|\/+$/g, "") : null;
  const out: ProductRecord[] = [];
  for (const s of swatches) {
    const m = markdownOf(s?.price);
    const colourNo = String(s?.colorNumber ?? "");
    if (!m || !colourNo) continue;
    // A swatch priced in another market's currency is never stored as this one's.
    if (country !== "US" && s?.price?.currency !== COUNTRIES[country].currency) continue;
    const codes: string[] = (Array.isArray(s.images) ? s.images : []).filter((c: unknown): c is string => typeof c === "string" && /^[A-Za-z0-9_]+$/.test(c));
    const photos = codes.map(photo);
    const colour = typeof s.colorName === "string" && s.colorName.trim() ? titleCase(s.colorName.trim()) : null;
    out.push({
      brand: "toryburch",
      country,
      externalId: `${id}-${colourNo}`,
      name,
      url: path ? `${SITE}/${loc}/${path}/${id}.html?color=${encodeURIComponent(colourNo)}` : `${SITE}/${loc}/${id}.html?color=${encodeURIComponent(colourNo)}`,
      imageUrl: photos[0] ?? null,
      images: cleanGallery(photos, photos[0] ?? null),
      price: toMinor(m.price),
      listPrice: toMinor(m.list),
      currency: COUNTRIES[country].currency,
      inStock: s.soldOut !== true,
      category: typeof p.productClassName === "string" && p.productClassName ? p.productClassName : null,
      gender: "kadin",
      variants: null,
      groupKey: swatches.length > 1 ? `toryburch-${id}` : null,
      colorName: colour,
    });
  }
  return out;
}

export const pageUrl = (offset: number, country: CountryCode = "US") =>
  `${API}/categories/${CATEGORY}/products?site=${(TORY_MARKETS[country] ?? TORY_MARKETS.US!).site}&limit=${PAGE}&offset=${offset}`;

export async function listToryBurch(country: CountryCode): Promise<ProductRecord[]> {
  const m = TORY_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page) await sleep(PAUSE_MS);
    const j = await getJson<any>(pageUrl(page * PAGE, country), {
      country,
      headers: { "x-api-key": API_KEY, Locale: m.locale, Referer: `${SITE}/${m.locale}/sale/view-all/` },
    });
    const products: any[] = j?.products ?? [];
    for (const p of products) for (const r of mapToryProduct(p, country)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    if (products.length < PAGE || (page + 1) * PAGE >= Number(j?.total ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
