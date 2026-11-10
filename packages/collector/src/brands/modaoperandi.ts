/**
 * Moda Operandi (modaoperandi.com) — luxury multi-brand, New York. One
 * catalogue, a price list per currency.
 *
 * The site's own search index is public Algolia (app + search-only key in the
 * page config, `ALGOLIA_APPLICATION_ID` / `ALGOLIA_API_KEY`): index
 * `Search_production_by_inventory_available`, one record per colour variant,
 * carrying `markdown_price_<cur>` and, per variant, `retail_price_<cur>` for
 * USD, CAD, GBP, EUR, AUD, HKD and AED (plus CNY and two USD regional lists we
 * do not serve). Algolia answers datacentre IPs (runner probe in the report).
 *
 * `marked_down=1 AND availability=1` is the in-stock sale (~1,400 styles of
 * ~3,000 marked down on 2026-11-10; availability 4 is sold out, 5 special
 * order). Home goods ride in the same index and are dropped. Two requests of
 * 1,000 a market.
 */
import { type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "modaoperandi";

export const APP_ID = "Z8CHXVEJ2D";
export const SEARCH_KEY = "51e8050565d2891eb06cf113aefd3f8d";
export const INDEX = "Search_production_by_inventory_available";
const SITE = "https://www.modaoperandi.com";
const PAGE = 1000;
const CAP = 1500;

/** Market → the index's price-list suffix (also the currency, lower-cased). */
export const MODA_MARKETS: Partial<Record<CountryCode, string>> = {
  US: "USD", CA: "CAD", GB: "GBP", AU: "AUD", HK: "HKD", AE: "AED",
  DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", IE: "EUR", PT: "EUR", FI: "EUR",
};

const FIELDS = [
  "name", "designer_name", "href", "gender_name", "variant_id", "product_id", "availability", "color",
  "master_preview_image_url", "gender_cat_subcat_attrs", "marked_down", "variants_data",
  ...["usd", "cad", "gbp", "aud", "hkd", "aed", "eur"].map((c) => `markdown_price_${c}`),
];

export const requestBody = (page: number): string =>
  JSON.stringify({
    params: `hitsPerPage=${PAGE}&page=${page}&filters=${encodeURIComponent("marked_down=1 AND availability=1")}` +
      `&attributesToRetrieve=${encodeURIComponent(JSON.stringify(FIELDS))}&attributesToHighlight=%5B%5D`,
  });

export function largeImage(u: unknown): string | null {
  if (typeof u !== "string" || !u.startsWith("https://")) return null;
  return u.replace(/\/(?:small_|medium_|large_)?([^/?]+\.(?:jpe?g|png|webp))(\?.*)?$/i, "/large_$1$2");
}

/** Map one index record. Pure; null unless a women's/men's style marked down in the market's currency. */
export function mapModa(h: any, country: CountryCode): ProductRecord | null {
  const currency = MODA_MARKETS[country];
  const id = String(h?.variant_id ?? "").trim();
  const title = String(h?.name ?? "").trim();
  const href = String(h?.href ?? "");
  const section = href.split("/")[1];
  if (!currency || !id || !title || (section !== "women" && section !== "men")) return null;
  const cur = currency.toLowerCase();
  const own = (Array.isArray(h.variants_data) ? h.variants_data : []).find((v: any) => String(v?.id) === id);
  const price = Math.round(Number(h[`markdown_price_${cur}`]) * 100);
  const list = Math.round(Number(own?.[`retail_price_${cur}`]) * 100);
  if (!(price > 0) || !(list > 0) || !(price < list)) return null;

  const sizes: SizeVariant[] = Object.values(own?.available_sizes ?? {})
    .filter((s: any) => s?.size && !/^(os|one size)$/i.test(String(s.size)))
    .map((s: any) => {
      const left = Number(Array.isArray(s.total_available) ? s.total_available[0] : s.total_available);
      return { label: String(s.size), availability: left > 0 ? (left <= 1 ? "low_on_stock" : "in_stock") : "out_of_stock" } as SizeVariant;
    });
  const anyLeft = Object.values(own?.available_sizes ?? {}).some((s: any) => Number(Array.isArray(s?.total_available) ? s.total_available[0] : s?.total_available) > 0);
  const make = String(h.designer_name ?? "").trim();
  const cats = String(h.gender_cat_subcat_attrs ?? "").split("|").filter(Boolean);
  // The master image is the 1.7 MB original; the same path serves a `large_` render (~150 KB).
  const img = largeImage(h.master_preview_image_url);
  return {
    brand,
    country,
    externalId: id,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url: `${SITE}${href}`,
    imageUrl: img,
    images: null,
    price,
    listPrice: list,
    currency,
    inStock: own ? own.sold_out !== true && anyLeft : Number(h.availability) === 1,
    category: cats.length > 1 ? cats[cats.length - 1].replace(/[-_]/g, " ") : null,
    maker: make || null,
    gender: section === "men" ? "erkek" : "kadin",
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: h.product_id ? String(h.product_id) : null,
    colorName: typeof h.color === "string" && h.color.trim() ? h.color.trim() : null,
  };
}

export async function listModaOperandi(country: CountryCode): Promise<ProductRecord[]> {
  if (!MODA_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let seen = 0;
  let problem = "";
  for (let page = 0; page < 3 && byId.size < CAP; page++) {
    const d = await getJson<any>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
      country,
      method: "POST",
      body: requestBody(page),
      headers: { "Content-Type": "application/json", "X-Algolia-Application-Id": APP_ID, "X-Algolia-API-Key": SEARCH_KEY },
      retries: 1,
      timeoutMs: 45_000,
    }).catch((e) => {
      problem = String(e).slice(0, 120);
      return null;
    });
    const hits: any[] = d?.hits ?? [];
    seen += hits.length;
    for (const h of hits) {
      const r = mapModa(h, country);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!hits.length || page + 1 >= Number(d?.nbPages ?? 0)) break;
  }
  if (seen === 0) throw new Error(`modaoperandi/${country}: the sale index returned no records (${problem})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listModaOperandi;
