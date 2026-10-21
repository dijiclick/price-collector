/**
 * Kruidvat (kruidvat.nl / kruidvat.be) — the Benelux drugstore chain
 * (A.S. Watson). The storefront and its OCC API (`api.kruidvat.nl`) sit behind
 * Akamai, which refuses GitHub's runners outright (probe run 39636006759).
 * The product feed Kruidvat syncs to Insider for its recommendation widgets
 * does not: same route as Mavi/Twist (`_insider.ts`), partner `kruidvatnl` /
 * `kruidvatbe` (from each site's `ins.js`), the public Insider client id, EUR.
 *
 *   https://recommendationv2.api.useinsider.com/v2/<strategy>?partnerName=…
 *     &locale=nl_NL&currency=EUR&details=true&size=100&clientId=…&filter=…
 *
 * Each row has `price`, `original_price`, `discount`, the category path and
 * (NL only) `product_attributes` with `item_on_promo` and
 * `marketplaceproduct`. Checked against the product pages 2026-10-21: every
 * promo row's `original_price` is the page's own struck "van" price
 * (`oldValueLabel = product.pricetag.from.label`) — 8/8 BE, 6/6 NL beauty.
 * Rows WITHOUT a promo can carry a manufacturer RRP as `original_price` that
 * the page never shows (marketplace sellers especially), so NL keeps only
 * `item_on_promo = true` and drops marketplace rows; the BE feed has no such
 * attribute, so BE drops `/p/mp-…` marketplace URLs and relies on the
 * page check above.
 *
 * Limits (as in `_insider.ts`): `size` ≤ 100, no paging, so the set is
 * partitioned. NL accepts category and price filters → per section, price
 * bands split until each holds < 100 rows. BE accepts only `discount > x`, so
 * BE unions a few strategies × discount thresholds; coverage there is "most
 * of the in-stock markdowns". The feed lists only in-stock products.
 * Measured 2026-10-21: NL Beauty 109 + Verzorging 17 marked down.
 *
 * Scope: beauty and personal care only — Gezondheid (medicines, supplements),
 * Baby, Huishouden, food and electronics are dropped, and so are electric
 * appliances filed under Verzorging (toothbrushes, shavers).
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const ENDPOINT = "https://recommendationv2.api.useinsider.com/v2";
const CLIENT_ID = "g0uSLhenGOKvzAtz";
const SIZE = 100;
const MAX_REQUESTS = 80;
const CAP = 1500;
const PAUSE_MS = Number(process.env.KRUIDVAT_PAUSE_MS ?? 250);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Market { partner: string; locale: string; origin: string }
export const KRUIDVAT_MARKETS: Partial<Record<CountryCode, Market>> = {
  NL: { partner: "kruidvatnl", locale: "nl_NL", origin: "https://www.kruidvat.nl" },
  BE: { partner: "kruidvatbe", locale: "nl_BE", origin: "https://www.kruidvat.be" },
};

const SECTIONS = ["Beauty", "Verzorging"];
const NL_STRATEGIES = ["most-popular", "new-arrivals"];
const BE_STRATEGIES = ["most-popular", "new-arrivals", "most-valuable", "trending", "top-sellers", "highest-discounted"];
const BE_THRESHOLDS = [0, 1, 2, 3, 5, 8, 12];

const ELECTRIC = /elektrisch|tandenborstel|scheerapparat|f[oö]hn|stijltang|krultang|tondeuse|epilator|trimmer|monddouche|opzetborstel|ladyshave/i;

export function kruidvatUrl(m: Market, strategy: string, filter: string): string {
  const q = new URLSearchParams({
    partnerName: m.partner,
    locale: m.locale,
    currency: "EUR",
    details: "true",
    size: String(SIZE),
    clientId: CLIENT_ID,
    filter,
  });
  return `${ENDPOINT}/${strategy}?${q}`;
}

/** `["[Beauty,Make-up,Mascara]"]` (NL) or `["Beauty"]` (BE) → ["Beauty","Make-up","Mascara"]. */
export function kruidvatPath(category: unknown): string[] {
  const first = Array.isArray(category) ? String(category[0] ?? "") : "";
  return first.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

const eur = (v: any): number => Number(v?.EUR ?? v);

/** One feed row → a record, or null when it is not a shown markdown or not beauty. Pure. */
export function mapKruidvatRow(x: any, country: CountryCode, requirePromoFlag: boolean): ProductRecord | null {
  const price = eur(x?.price);
  const was = eur(x?.original_price);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const url = typeof x?.url === "string" ? x.url.split("#")[0] : "";
  const id = String(x?.item_id ?? "");
  const name = String(x?.name ?? "").trim();
  if (!url || !id || !name) return null;
  if (/\/p\/mp-/i.test(url)) return null; // marketplace seller, not Kruidvat's own price
  const attrs = x?.product_attributes ?? null;
  if (requirePromoFlag) {
    if (attrs?.item_on_promo !== "true") return null;
    if (attrs?.marketplaceproduct && attrs.marketplaceproduct !== "false") return null;
    if (attrs?.healthproduct && attrs.healthproduct !== "false") return null;
  }
  const path = kruidvatPath(x?.category);
  if (!SECTIONS.includes(path[0] ?? "")) return null;
  if (ELECTRIC.test([...path, name].join(" "))) return null;
  const img = typeof x?.image_url === "string" && /^https:\/\//.test(x.image_url) ? x.image_url : null;
  const gtin = typeof x?.gtin === "string" && /^\d{8,14}$/.test(x.gtin) ? [x.gtin] : null;
  return {
    brand: "kruidvat",
    country,
    externalId: id,
    name,
    url,
    imageUrl: img,
    images: cleanGallery([img]),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "EUR",
    inStock: x?.in_stock !== 0 && x?.in_stock !== "0",
    barcodes: gtin,
    category: path[path.length - 1] ?? null,
    maker: typeof x?.brand === "string" && x.brand.trim() && !/^overig$/i.test(x.brand) ? x.brand.trim() : null,
    gender: null,
  };
}

/** Register as `listKruidvat(country)`. NL, BE. */
export async function listKruidvat(country: CountryCode): Promise<ProductRecord[]> {
  const m = KRUIDVAT_MARKETS[country];
  if (!m) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let rowsSeen = 0;
  const fetchRows = async (strategy: string, filter: string): Promise<any[]> => {
    if (++requests > MAX_REQUESTS) throw new Error(`kruidvat ${country}: more than ${MAX_REQUESTS} requests`);
    if (requests > 1) await sleep(PAUSE_MS);
    const d = await getJson<any>(kruidvatUrl(m, strategy, filter), { country });
    const rows: any[] = Array.isArray(d?.data) ? d.data : [];
    rowsSeen += rows.length;
    return rows;
  };
  const take = (rows: any[], requirePromo: boolean) => {
    for (const x of rows) {
      const r = mapKruidvatRow(x, country, requirePromo);
      if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  };

  if (country === "NL") {
    const base = "[discount.EUR][>][0]*[product_attributes.item_on_promo][=][true]";
    for (const strategy of NL_STRATEGIES) {
      for (const section of SECTIONS) {
        const queue: [number, number][] = [[0, 1000]];
        while (queue.length) {
          const [lo, hi] = queue.shift()!;
          const rows = await fetchRows(strategy, `${base}*[category][~][${section}]*[price.EUR][>][${lo}]*[price.EUR][<][${hi}]`);
          if (rows.length >= SIZE) {
            if (hi - lo <= 0.02) throw new Error(`kruidvat NL: ${section} band ${lo}–${hi} still holds ${SIZE}+ rows`);
            const mid = Math.round(((lo + hi) / 2) * 100) / 100;
            queue.push([lo, mid], [mid - 0.001, hi]);
            continue;
          }
          take(rows, true);
        }
      }
    }
  } else {
    for (const strategy of BE_STRATEGIES) {
      for (const t of BE_THRESHOLDS) take(await fetchRows(strategy, `[discount.EUR][>][${t}]`), false);
    }
  }
  if (!rowsSeen) throw new Error(`kruidvat ${country}: the Insider feed returned no rows`);
  return [...byId.values()].slice(0, CAP);
}
