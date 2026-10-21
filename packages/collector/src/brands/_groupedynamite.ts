/**
 * Groupe Dynamite — Garage (garageclothing.com) and Dynamite
 * (dynamiteclothing.com), Canada and United States. One Salesforce B2C
 * Commerce org (`f_ecom_bksx_prd`) with one site per country
 * (`DynamiteGarageCA`, `DynamiteGarageUS`) holding both brands.
 *
 * Both storefronts are PWA Kit apps behind Akamai: every page, and the
 * `/mobify/...` proxies on the www host, answer 403 to a GitHub runner. Two
 * things are not walled:
 *  - the app's Managed Runtime origin (`appOrigin` in the page config,
 *    `gdi-gar-bksx-prd.sfdc-8tgtt5-ecom1.exp-delivery.com`), whose
 *    `/mobify/slas/private` route is the app's own SLAS proxy: it adds the
 *    private client's secret server-side and hands back a guest token for a
 *    plain `client_credentials` POST;
 *  - SCAPI itself (`7rwroufa.api.commercecloud.salesforce.com`, Salesforce's
 *    Cloudflare), which accepts that token.
 * Both verified from a GitHub runner, no proxy: probe run 38134835174.
 *
 * Flow per market: 1 token + shopper-search on the brand's sale category
 * (`grg_sale` / `dyn_sale`, 200 per page, `perPricebook=true` for the list and
 * sale price books) + shopper-products in batches of 24 for per-size
 * `orderable` (= restock alerts) and the promotional price. ~30 requests for
 * ~550 products.
 *
 * Promotions: most sale styles also carry an automatic "Extra 30%" promotion
 * that the product page shows as the current price (the PWA's getPriceData
 * takes the lowest `productPromotions[].promotionalPrice` below the price,
 * e.g. "$14.00" over a struck "$34.95" while the sale book says 20.00). Search
 * hits list the promotion but not its price; shopper-products with
 * `expand=promotions` has it, so the detail pass lowers `price` to it. A guest
 * token only gets the promotions that apply to a guest, so no loyalty or
 * employee prices. If the detail call fails the sale-book price stays.
 */
import { type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ORG = "f_ecom_bksx_prd";
const SCAPI = "https://7rwroufa.api.commercecloud.salesforce.com";
const TOKEN_URL = `https://gdi-gar-bksx-prd.sfdc-8tgtt5-ecom1.exp-delivery.com/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`;
const PAGE_SIZE = 200;
const BATCH = 24; // shopper-products `ids` maximum
const MAX_DETAIL_CALLS = 45;
const PAUSE_MS = 500;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GdiBrand = "garage" | "dynamite";

export const GDI_SITES: Partial<Record<CountryCode, { siteId: string; locale: string; path: string }>> = {
  CA: { siteId: "DynamiteGarageCA", locale: "en-CA", path: "/ca" },
  US: { siteId: "DynamiteGarageUS", locale: "en-US", path: "/us" },
};

export const GDI_BRANDS: Record<GdiBrand, { category: string; site: string }> = {
  garage: { category: "grg_sale", site: "https://www.garageclothing.com" },
  dynamite: { category: "dyn_sale", site: "https://www.dynamiteclothing.com" },
};

/** The two price books a search hit carries with `perPricebook=true`. Null unless reduced. */
export function pricesOf(hit: any): { list: number; sale: number } | null {
  const ranges: any[] = hit?.priceRanges ?? [];
  const list = ranges.find((r) => /_list_price$/.test(String(r?.pricebook)));
  const sale = ranges.find((r) => /_sale_price$/.test(String(r?.pricebook)));
  // min vs min: a size range is not a discount.
  const l = Number(list?.minPrice);
  const s = Number(sale?.minPrice ?? hit?.price);
  if (!(l > 0) || !(s > 0) || s >= l) return null;
  return { list: l, sale: s };
}

/** Map one search hit (a variation group = one colour of one style). Pure. */
export function mapGdiHit(brand: GdiBrand, hit: any, country: CountryCode): ProductRecord | null {
  const site = GDI_SITES[country];
  if (!site || !hit?.productId || !hit?.productName) return null;
  if (hit.currency && hit.currency !== COUNTRIES[country].currency) return null;
  const p = pricesOf(hit);
  if (!p) return null;
  const rel = typeof hit.c_relativeUrl === "string" && hit.c_relativeUrl.startsWith("/") ? hit.c_relativeUrl : `/p/${hit.productId}.html`;
  const img = typeof hit.image?.link === "string" ? hit.image.link : null;
  const title = typeof hit.image?.title === "string" ? hit.image.title : "";
  const colour = title.includes(",") ? title.split(",").pop()!.trim() : null;
  return {
    brand,
    country,
    externalId: String(hit.productId),
    name: String(hit.productName).trim(),
    url: `${GDI_BRANDS[brand].site}${site.path}${rel}`,
    imageUrl: img,
    images: img ? [img] : null,
    price: toMinor(p.sale),
    listPrice: toMinor(p.list),
    currency: COUNTRIES[country].currency,
    inStock: hit.orderable !== false,
    category: null,
    gender: "kadin",
    variants: null,
    groupKey: null,
    colorName: colour,
  };
}

/**
 * The promotional price the product page shows: the lowest
 * `promotionalPrice` among the record's (or its variants') product
 * promotions. Null when there is none.
 */
export function promoPriceOf(prod: any): number | null {
  const promos: any[] = [...(prod?.productPromotions ?? []), ...(prod?.variants ?? []).flatMap((v: any) => v?.productPromotions ?? [])];
  const prices = promos.map((p) => Number(p?.promotionalPrice)).filter((n) => n > 0);
  return prices.length ? Math.min(...prices) : null;
}

/** Fold one shopper-products record into its search-hit record: sizes, category, promotional price. */
export function applyGdiProduct(r: ProductRecord, prod: any): void {
  const { sizes, category, colour } = sizesOf(prod);
  if (sizes.length) {
    r.variants = { colors: colour ? [colour] : [], sizes };
    r.inStock = sizes.some((s) => s.availability === "in_stock");
  }
  r.category = category ?? r.category ?? null;
  r.colorName = colour ?? r.colorName ?? null;
  const promo = promoPriceOf(prod);
  if (promo != null && toMinor(promo) < r.price) r.price = toMinor(promo);
}

/**
 * Per-size stock from a shopper-products record of a variation group. Its
 * `variants` are this colour's sizes; non-colour axes (size, and length/inseam
 * on bottoms) are joined into one label, in the order the size chips show.
 */
export function sizesOf(prod: any): { sizes: SizeVariant[]; category: string | null; colour: string | null } {
  const attrs: any[] = (prod?.variationAttributes ?? []).filter((a: any) => a?.id !== "color");
  const order = new Map<string, number>();
  attrs.forEach((a, ai) => (a?.values ?? []).forEach((v: any, vi: number) => order.set(`${a.id}:${v.value}`, ai * 1000 + vi)));
  const nameOf = (id: string, value: string) =>
    attrs.find((a) => a.id === id)?.values?.find((v: any) => v.value === value)?.name ?? value;
  const rows = (prod?.variants ?? [])
    .map((v: any) => {
      const vv = v?.variationValues ?? {};
      const keys = attrs.map((a) => a.id).filter((k) => vv[k] != null);
      if (!keys.length) return null;
      const label = keys.map((k) => String(nameOf(k, String(vv[k])))).join(" / ");
      const rank = keys.reduce((s, k, i) => s + (order.get(`${k}:${vv[k]}`) ?? 999) * Math.pow(1000, keys.length - 1 - i), 0);
      return { label, rank, ok: v?.orderable === true };
    })
    .filter(Boolean) as { label: string; rank: number; ok: boolean }[];
  rows.sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const r of rows) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    sizes.push({ label: r.label, availability: r.ok ? "in_stock" : "out_of_stock" });
  }
  // c_categories is [class, family, department], e.g. ["Slim", "Fleece Pants", "Pants "];
  // the family is the product type.
  const cats = (Array.isArray(prod?.c_categories) ? prod.c_categories : []).map((c: unknown) => String(c).trim());
  const category = cats[1] || cats[0] || null;
  const colour = typeof prod?.c_colorName === "string" ? prod.c_colorName : null;
  return { sizes, category, colour };
}

async function guestToken(siteId: string): Promise<string> {
  const t = await getJson<any>(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&channel_id=${siteId}`,
  });
  if (!t?.access_token) throw new Error("groupedynamite: no guest token");
  return t.access_token;
}

export async function listGroupeDynamite(brand: GdiBrand, country: CountryCode): Promise<ProductRecord[]> {
  const site = GDI_SITES[country];
  if (!site) return [];
  const currency = COUNTRIES[country].currency;
  const token = await guestToken(site.siteId);
  const auth = { authorization: `Bearer ${token}` };

  const byId = new Map<string, ProductRecord>();
  for (let offset = 0; offset < CAP + PAGE_SIZE; offset += PAGE_SIZE) {
    if (offset > 0) await sleep(PAUSE_MS);
    const q = new URLSearchParams({
      siteId: site.siteId,
      refine: `cgid=${GDI_BRANDS[brand].category}`,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      locale: site.locale,
      currency,
      perPricebook: "true",
    });
    const data = await getJson<any>(`${SCAPI}/search/shopper-search/v1/organizations/${ORG}/product-search?${q}`, { country, headers: auth });
    const hits: any[] = data?.hits ?? [];
    for (const h of hits) {
      const r = mapGdiHit(brand, h, country);
      if (r) byId.set(r.externalId, r);
    }
    if (hits.length < PAGE_SIZE || offset + PAGE_SIZE >= Number(data?.total ?? 0)) break;
  }

  const all = [...byId.values()];
  const ordered = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  const ids = ordered.map((r) => r.externalId);
  for (let i = 0, calls = 0; i < ids.length && calls < MAX_DETAIL_CALLS; i += BATCH, calls++) {
    await sleep(PAUSE_MS);
    const q = new URLSearchParams({
      siteId: site.siteId,
      ids: ids.slice(i, i + BATCH).join(","),
      locale: site.locale,
      currency,
      expand: "availability,variations,promotions",
      allImages: "false",
    });
    const data = await getJson<any>(`${SCAPI}/product/shopper-products/v1/organizations/${ORG}/products?${q}`, { country, headers: auth }).catch(() => null);
    for (const prod of data?.data ?? []) {
      const r = byId.get(String(prod?.id));
      if (r) applyGdiProduct(r, prod);
    }
  }
  return [...ordered.filter((r) => r.inStock), ...ordered.filter((r) => !r.inStock)];
}
