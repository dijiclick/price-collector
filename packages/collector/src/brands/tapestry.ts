/**
 * Tapestry outlets — Coach Outlet (US + Canada) and Kate Spade Outlet (US) —
 * through the XGen AI search index their own storefronts query.
 *
 * coach.com (Coach Outlet now lives at coach.com/shop/outlet; coachoutlet.com
 * redirects there and coachoutlet.ca is a parked domain) and katespadeoutlet.com
 * are Next.js-on-Vercel behind Akamai Bot Manager: every page and /api route
 * answers 403 to a GitHub runner. Their search is XGen (prompt.xgen.dev), and
 * XGen answers a plain POST from a runner — no proxy (probe run 38221066048,
 * 2026-10-12). XGen's own WAF only wants a browser User-Agent (curl's default
 * gets 403), which getJson already sends.
 *
 * Auth is the public key/secret pair every shopper's browser gets in the
 * per-client integration script on assets.xgen.dev
 * (`/js/<clientId>/sdkIntegration.js`). It is read from that script at run
 * time rather than copied here, so a rotation does not break the crawler.
 *
 * XGen is query-driven (an empty query matches almost nothing), so the sale is
 * gathered by a handful of broad category words with the storefront's own
 * "Percent Off" facet set to every bucket — i.e. reduced items only — and
 * deduplicated by colour code. Measured 2026-10-12: Coach US 6 words → 837
 * colours in 21 requests (28 words only reach 846); Kate Spade 6 words → 1,573
 * in 30 requests (16 words: 1,610). Pages are capped at 60 hits by the API.
 *
 * One hit is one colour of one style. Prices: `price` is the outlet's
 * "comparable value" and `sale_price` the selling price — this is exactly the
 * strikethrough pair the outlet PLP/PDP shows, unless the product sets
 * `hide_comparable_price_value`, in which case the site shows no "was" price and
 * neither do we (the row is dropped). Employee/member/private-sale prices are
 * opt-in and dropped; cart-only "extra N% off" promotions are ignored.
 *
 * Sized products (shoes, clothing, rings) come back one hit per colour with a
 * single representative size, so per-size stock is NOT available from this
 * feed; colour-level stock (`is_in_stock` + `quantity`) is.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type TapestryBrand = "coachoutlet" | "katespadeoutlet";

interface Market {
  /** XGen collection (the SDK's localeConfig key); absent = the default (US) index. */
  collection?: string;
  /** Storefront prefix that replaces https://www.coach.com/ in product URLs. */
  site?: string;
}

interface BrandConfig {
  clientId: string;
  deploymentId: string;
  /** Extra search context: Coach's index holds retail and outlet, split by channel. */
  context: Record<string, unknown>;
  /** Kate Spade's index leaves gender empty on most rows; it is a women's label. */
  defaultGender: ProductRecord["gender"];
  markets: Partial<Record<CountryCode, Market>>;
}

export const TAPESTRY: Record<TapestryBrand, BrandConfig> = {
  coachoutlet: {
    clientId: "6d13303626fe8a8695bf323b4e0b86be",
    deploymentId: "f550a919-1942-44f0-bf83-9c1bc36c6268",
    context: { channel: "Outlet" },
    defaultGender: null,
    markets: {
      US: {},
      CA: { collection: "ca-en", site: "https://ca.coach.com/en/" },
    },
  },
  katespadeoutlet: {
    clientId: "c3d9d703ad5a126e11e3d5390a4bf49b",
    deploymentId: "a4b440f6-a9eb-46a9-a930-b7bdb1c2abbf",
    context: {},
    defaultGender: "kadin",
    // katespadeoutlet.ca is parked; there is no Canadian outlet store.
    markets: { US: {} },
  },
};

/** Broad words that together cover the outlet sale (see the measurements above). */
const TERMS = ["bag", "wallet", "shoes", "clothing", "accessories", "jewelry", "signature"];
/** The storefront's "Percent Off" facet buckets — every one, i.e. "on sale". */
const DISCOUNT_BUCKETS = ["0% - 10%", "10% - 20%", "20% - 30%", "30% - 40%", "40% - 50%", "50% - 60%", "60% - 65%", "65% - 70%", "70% +"];
const PAGE = 60; // the API's own maximum page size
const MAX_PAGES_PER_TERM = 10;
const MAX_REQUESTS = 55;
const CAP = 1500;
const CONCURRENCY = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the public key/secret out of the client's integration script. */
export function parseXgenKeys(js: string): { key: string; secret: string } | null {
  const key = /\bkey:\s*['"]([a-f0-9]{16,})['"]/.exec(js)?.[1];
  const secret = /\bsecret:\s*['"]([a-f0-9]{32,})['"]/.exec(js)?.[1];
  return key && secret ? { key, secret } : null;
}

export function searchRequest(brand: TapestryBrand, country: CountryCode, query: string, page: number) {
  const b = TAPESTRY[brand];
  const m = b.markets[country]!;
  return {
    url: `https://prompt.xgen.dev/customers/${b.clientId}/users/modadrop?page_size=${PAGE}`,
    body: {
      deployment_id: b.deploymentId,
      context: {
        locale: country === "CA" ? "en_CA" : "en_US",
        currency: COUNTRIES[country].currency,
        currentDate: Math.floor(Date.now() / 1000),
        ...b.context,
        filterByDiscount: DISCOUNT_BUCKETS,
      },
      page,
      query,
      ...(m.collection ? { collection: m.collection } : {}),
    },
  };
}

/** The price in force now, from the price book's dated entries; null if none. */
function activePrice(entries: unknown, now: number): number | null {
  if (!Array.isArray(entries)) return null;
  let hit: number | null = null;
  for (const e of entries as any[]) {
    const p = Number(e?.price);
    if (Number(e?.start) <= now && now < Number(e?.end) && Number.isFinite(p) && p > 0) hit = p;
  }
  return hit;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
};

function genderOf(g: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const s = String(g ?? "").toLowerCase();
  if (/^(women|womens|woman|female)$/.test(s)) return "kadin";
  if (/^(men|mens|man|male)$/.test(s)) return "erkek";
  if (/kid|girl|boy|child/.test(s)) return "cocuk";
  if (s) return null; // "All Gender", "Unisex"
  return fallback;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const NOT_A_TYPE = /view all|hidden|system|shop by|new arrivals|clearance/i;

/** Map one XGen hit (one colour). Pure; null unless the colour is genuinely reduced. */
export function mapTapestryHit(hit: any, brand: TapestryBrand, country: CountryCode, now = Date.now() / 1000): ProductRecord | null {
  const cfg = TAPESTRY[brand];
  const m = cfg.markets[country];
  if (!m || !hit?.prod_code || !hit?.prod_name || !hit?.product_url) return null;
  // Opt-in prices are not a public sale.
  if (hit.is_employee_sale || hit.is_private_sale || hit.is_member_exclusive) return null;
  // The site shows no strikethrough for these, so there is no honest "was" price.
  if (hit.hide_comparable_price_value) return null;

  const book = hit.price_book ?? {};
  // A dated price book is authoritative: a sale whose window has closed is over,
  // whatever the flat `sale_price` field still says.
  const dated = (a: unknown) => Array.isArray(a) && a.length > 0;
  const list = dated(book.prices) ? activePrice(book.prices, now) : num(hit.price);
  const sale = dated(book.sale_prices) ? activePrice(book.sale_prices, now) : num(hit.sale_price);
  if (list == null || sale == null || sale >= list) return null;

  const own = (hit.variants ?? []).find((v: any) => v?.group_id === hit.prod_code) ?? null;
  const types: string[] = Array.isArray(own?.product_types) ? own.product_types.map(String) : [];
  const cats: string[] = Array.isArray(hit.categories) ? hit.categories.map(String) : [];
  const leaf = [...cats].reverse().find((c) => c && !NOT_A_TYPE.test(c) && !/^(women|men|bags|shoes|clothing|jewelry|accessories)$/i.test(c));
  const category = types.find((t) => t && !NOT_A_TYPE.test(t)) || leaf || (typeof hit.category === "string" && hit.category ? titleCase(hit.category) : null);

  const url = m.site ? String(hit.product_url).replace(/^https:\/\/www\.coach\.com\//, m.site) : String(hit.product_url);
  const images: string[] = Array.isArray(hit.images) ? hit.images.map(String) : [];
  const image = typeof hit.image === "string" ? hit.image : images[0] ?? null;
  const colour = typeof hit.color === "string" && hit.color.trim() ? hit.color.trim() : null;
  const upc = !hit.is_sized && typeof own?.upc === "string" && /^\d{12,13}$/.test(own.upc) ? own.upc : null;
  const qty = Number(hit.quantity);

  return {
    brand,
    country,
    externalId: String(hit.prod_code),
    name: String(hit.prod_name).trim(),
    url,
    imageUrl: image,
    images: cleanGallery(images, image),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: hit.is_in_stock === true && !(Number.isFinite(qty) && qty <= 0),
    barcodes: upc ? [upc] : null,
    category,
    gender: genderOf(hit.gender, cfg.defaultGender),
    variants: null,
    groupKey: hit.master_id ? `${brand}-${hit.master_id}` : null,
    colorName: colour,
  };
}

export async function listTapestry(brand: TapestryBrand, country: CountryCode): Promise<ProductRecord[]> {
  const cfg = TAPESTRY[brand];
  if (!cfg?.markets[country]) return [];
  const keys = parseXgenKeys(await getText(`https://assets.xgen.dev/js/${cfg.clientId}/sdkIntegration.js`, { country }));
  if (!keys) throw new Error(`${brand}/${country}: XGen keys not found in the integration script`);
  const headers = { "content-type": "application/json", "x-api-key": keys.key, "x-api-secret": keys.secret };

  let requests = 1;
  const search = async (term: string, page: number): Promise<any> => {
    requests++;
    const { url, body } = searchRequest(brand, country, term, page);
    return getJson<any>(url, { method: "POST", headers, body: JSON.stringify(body), country });
  };

  const byId = new Map<string, ProductRecord>();
  const add = (data: any) => {
    for (const h of data?.products_list ?? []) {
      if (byId.has(String(h?.prod_code))) continue;
      const r = mapTapestryHit(h, brand, country);
      if (r) byId.set(r.externalId, r);
    }
  };

  // First page of every term in parallel (bounded), then the remaining pages.
  const followUps: Array<[string, number]> = [];
  for (let i = 0; i < TERMS.length; i += CONCURRENCY) {
    const batch = TERMS.slice(i, i + CONCURRENCY);
    const firsts = await Promise.all(
      batch.map((t) => search(t, 0).catch((e) => (console.warn(`${brand}/${country}: "${t}" failed: ${e}`), null))),
    );
    firsts.forEach((d, j) => {
      if (!d) return;
      add(d);
      const pages = Math.min(MAX_PAGES_PER_TERM, Math.ceil(Number(d.total_result ?? 0) / PAGE));
      for (let p = 1; p < pages; p++) followUps.push([batch[j], p]);
    });
  }
  for (let i = 0; i < followUps.length && requests < MAX_REQUESTS; i += CONCURRENCY) {
    const batch = followUps.slice(i, i + Math.min(CONCURRENCY, MAX_REQUESTS - requests));
    const pages = await Promise.all(batch.map(([t, p]) => search(t, p).catch(() => null)));
    pages.forEach(add);
    await sleep(200);
  }
  if (followUps.length && requests >= MAX_REQUESTS) console.warn(`${brand}/${country}: request budget reached at ${requests}`);

  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
