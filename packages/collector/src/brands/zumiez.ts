/**
 * Zumiez (US: zumiez.com, CA: zumiez.ca) — multi-brand skate/street store.
 *
 * The listings come from the store's own Reflektion (Sitecore Search) endpoint,
 * named in each site's `window.reflektionConfig.reflektion_api_url`:
 *
 *   GET https://zumiez-us-prod.sc.zumiez.com/api/search-rec/3?data=<json>
 *   GET https://zumiez-ca-prod.sc.zumiez.ca/api/search-rec/3?data=<json>
 *
 * with the PLP widget (`rfkid_10`) and the site's own "All discounted items"
 * facet (`percent_off_facet`) as a filter, split by `en.att_lifestage`. No key.
 *
 * Each result carries `price` (the regular price the site strikes through) and
 * `final_price` (the sale price), in the site's currency, plus `brand` (the
 * maker), `stock_quantity` and a breadcrumb trail. Skate/snow hardware,
 * stickers and home goods are dropped: only Clothing, Shoes and Accessories.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "zumiez";

export const ZUMIEZ_MARKETS: Partial<Record<CountryCode, { api: string; site: string; currency: string }>> = {
  US: { api: "https://zumiez-us-prod.sc.zumiez.com/api/search-rec/3", site: "https://www.zumiez.com", currency: "USD" },
  CA: { api: "https://zumiez-ca-prod.sc.zumiez.ca/api/search-rec/3", site: "https://www.zumiez.ca", currency: "CAD" },
};

const PER_PAGE = 100;
const CAP = 1500;
const PAUSE_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Walk per life stage: label, section gender, pages of 100. */
export const ZUMIEZ_WALKS: [stage: string, gender: ProductRecord["gender"], pages: number][] = [
  ["Women's", "kadin", 7],
  ["Men's", "erkek", 9],
];

export function searchUrl(country: CountryCode, stage: string, page: number): string {
  const m = ZUMIEZ_MARKETS[country];
  if (!m) throw new Error(`zumiez: no market ${country}`);
  const data = {
    widget: { rfkid: "rfkid_10" },
    n_item: PER_PAGE,
    page_number: page,
    content: { product: {} },
    filter: { percent_off_facet: { value: ["All discounted items"] }, "en.att_lifestage": { value: [stage] } },
  };
  return `${m.api}?data=${encodeURIComponent(JSON.stringify(data))}`;
}

const KEEP = /^(Men's Clothing|Women's Clothing|Shoes|Accessories|Kids'? Clothing|Boys|Girls)/i;

/** Map one Reflektion result. Pure; null unless reduced and a fashion item. */
export function mapZumiez(p: any, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord | null {
  const m = ZUMIEZ_MARKETS[country];
  if (!m || !p?.id || !p?.name || !p?.product_url) return null;
  const list = Number(p.price);
  const price = Number(p.final_price);
  if (!(price > 0) || !(list > price)) return null;

  const crumbs = String(p.breadcrumbs ?? "").split(" | ").map((b) => b.split(" > ").slice(1));
  const top = crumbs[0]?.[0] ?? "";
  if (!KEEP.test(top)) return null;
  // The deepest trail under the same top section names the product type.
  const deepest = crumbs.filter((c) => c[0] === top).sort((a, b) => b.length - a.length)[0] ?? [];
  const leaf = deepest[deepest.length - 1] ?? null;
  const kids = /kid|boys|girls|youth/i.test(top) || /\b(kids?|youth|boys|girls)\b/i.test(String(p.name));

  const img = typeof p.image_url === "string" && p.image_url ? `https:${p.image_url.replace(/^https?:/, "")}?wid=800&hei=800` : null;
  const make = typeof p.brand === "string" && p.brand.trim() ? p.brand.trim() : null;
  const stock = Number(p.stock_quantity);
  const colour = typeof p.color === "string" && p.color.trim() ? p.color.trim() : null;

  return {
    brand,
    country,
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: m.site + String(p.product_url),
    imageUrl: img,
    images: cleanGallery([], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: m.currency,
    inStock: p.stock_quantity == null ? true : stock > 0,
    category: leaf && leaf !== top ? leaf.trim() : top || null,
    maker: make,
    gender: kids ? "cocuk" : gender,
    variants: null,
    groupKey: p.product_group ? `zumiez-${country}-${p.product_group}` : null,
    colorName: colour,
  };
}

export async function listZumiez(country: CountryCode): Promise<ProductRecord[]> {
  if (!ZUMIEZ_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const [stage, gender, pages] of ZUMIEZ_WALKS) {
    for (let page = 1; page <= pages; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(searchUrl(country, stage, page), { country, retries: 1, timeoutMs: 30_000 });
      if (Array.isArray(d?.errors) && d.errors.some((e: any) => e?.severity === "high" && e?.code !== 1008)) {
        throw new Error(`zumiez/${country}: ${JSON.stringify(d.errors).slice(0, 200)}`);
      }
      const items: any[] = d?.content?.product?.value ?? [];
      if (!items.length && page === 1) throw new Error(`zumiez/${country}: ${stage} returned no products`);
      for (const p of items) {
        const r = mapZumiez(p, country, gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (items.length < PER_PAGE || page >= Number(d?.total_page ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listZumiez;
