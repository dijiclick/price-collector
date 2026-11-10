/**
 * THG beauty stores — LOOKFANTASTIC (lookfantastic.com GBP, lookfantastic.ie
 * EUR) and Cult Beauty (cultbeauty.co.uk GBP). Added 2026-11-10.
 *
 * Every THG storefront talks to its own "Horizon" GraphQL API
 * (`horizonEndpoint` in the page config: `https://horizon-api.<site host>/graphql`).
 * It needs no key or cookie and answers a GitHub runner (probe run
 * 42802608232). A listing page is `page(path) { widgets { ... on
 * ProductListWidget { productList(input) } } }`; each product's
 * `defaultVariant.price` has `price` (charged) and `rrp` for the currency and
 * shipping destination asked.
 *
 * Walked: the store's own offers/sale listing, `DISCOUNT_PERCENTAGE_HIGH_TO_LOW`
 * first. An "offer" there can also be a code or a gift, so only rows with rrp
 * above price are kept. A gift set's rrp is its "worth" (the sum of the parts),
 * not a price it sold at — sets, kits, bundles and advent calendars are dropped.
 * `brand.name` is the maker.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type ThgSlug = "lookfantastic" | "cultbeauty";

interface ThgMarket { host: string; path: string }

export const THG_SITES: Record<ThgSlug, Partial<Record<CountryCode, ThgMarket>>> = {
  lookfantastic: {
    GB: { host: "www.lookfantastic.com", path: "/health-beauty/offers/view-all" },
    IE: { host: "www.lookfantastic.ie", path: "/health-beauty/offers/view-all" },
  },
  cultbeauty: {
    GB: { host: "www.cultbeauty.co.uk", path: "/sale" },
  },
};

const PAGE = 100;
const MAX_PAGES = Number(process.env.THG_MAX_PAGES ?? 16);
const PAUSE_MS = Number(process.env.THG_PAUSE_MS ?? 800);
const CAP = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sets priced against their "worth". */
export const THG_SET = /\b(sets?|kits?|duo|trio|bundle|collection|advent|calendar|gift|worth|edit|routine|regime|box)\b/i;

export function thgQuery(currency: string, dest: string): string {
  const ctx = `currency: ${currency}, shippingDestination: ${dest}`;
  return `query($p: PagePath!, $in: ProductListInput!) { page(path: $p) { widgets { __typename ... on ProductListWidget { productList(input: $in) { total hasMore products { sku title url brand { name } images(limit: 4) { original } defaultVariant(options: { ${ctx} }) { inStock price(${ctx}) { price { amount } rrp { amount } } } } } } } } }`;
}

/** One Horizon product → record, or null. Pure. */
export function mapThg(slug: ThgSlug, country: CountryCode, p: any): ProductRecord | null {
  const m = THG_SITES[slug][country];
  const v = p?.defaultVariant;
  const price = Number(v?.price?.price?.amount);
  const was = Number(v?.price?.rrp?.amount);
  if (!m || !p?.sku || !p?.title || !p?.url || !Number.isFinite(price) || price <= 0) return null;
  const title = String(p.title).replace(/\s+/g, " ").trim();
  if (THG_SET.test(title)) return null;
  const maker = typeof p.brand?.name === "string" && p.brand.name.trim() ? p.brand.name.trim() : null;
  const imgs: string[] = (p.images ?? []).map((i: any) => i?.original).filter((u: unknown): u is string => typeof u === "string");
  return {
    brand: slug,
    country,
    externalId: String(p.sku),
    name: title,
    url: `https://${m.host}${p.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: v.inStock !== false,
    category: null,
    maker,
    gender: null,
    variants: null,
  };
}

/** Register as `listThg("lookfantastic" | "cultbeauty", country)`. */
export async function listThg(slug: ThgSlug, country: CountryCode): Promise<ProductRecord[]> {
  const m = THG_SITES[slug][country];
  if (!m) return [];
  const currency = COUNTRIES[country].currency;
  const query = thgQuery(currency, country);
  const byId = new Map<string, ProductRecord>();
  for (let n = 0; n < MAX_PAGES && byId.size < CAP; n++) {
    if (n > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(`https://horizon-api.${m.host}/graphql`, {
      method: "POST",
      country,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { p: m.path, in: { currency, shippingDestination: country, limit: PAGE, offset: n * PAGE, sort: "DISCOUNT_PERCENTAGE_HIGH_TO_LOW", facets: [] } },
      }),
    });
    if (data?.errors?.length) throw new Error(`${slug}/${country}: ${String(data.errors[0]?.message ?? "graphql error").slice(0, 200)}`);
    const list = (data?.data?.page?.widgets ?? []).find((w: any) => w?.productList)?.productList;
    if (!list) {
      if (n === 0) throw new Error(`${slug}/${country}: no product list at ${m.path}`);
      break;
    }
    let reduced = 0;
    for (const p of list.products ?? []) {
      const was = Number(p?.defaultVariant?.price?.rrp?.amount);
      const now = Number(p?.defaultVariant?.price?.price?.amount);
      if (was > now) reduced++;
      const r = mapThg(slug, country, p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    // Deepest discount first: a page with no reduction ends the walk.
    if (!list.hasMore || reduced === 0) break;
  }
  if (!byId.size) throw new Error(`${slug}/${country}: no reduced rows`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
