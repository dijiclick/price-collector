/**
 * Token-carrying sibling of _storefront.ts (which serves tokenless shops). For
 * Shopify stores whose `/products.json` is closed (Hydrogen
 * headless fronts, or a bot rule on `/products*`) but whose own pages ship a
 * PUBLIC Storefront API token — the same token every visitor's browser sends,
 * read from the page HTML. The API lives on `<shop>.myshopify.com`, Shopify's
 * own edge, so it answers datacenter IPs regardless of the brand's WAF.
 *
 * One GraphQL page = 100 products with every variant's price, compare-at price,
 * availability and stock count, so a sale collection is a handful of requests.
 * The collection's `available` filter splits it: in-stock rows first, then the
 * sold-out ones (the rows a size restock lights up) until the cap.
 *
 * If a store rotates its token the request answers 401/403; the adapter then
 * re-reads the token from `tokenPage` once and retries. Rows priced in any
 * currency other than the market's are dropped, so a token from another of the
 * brand's stores can never leak foreign prices in.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface SaleStore {
  brand: string;
  /** `<shop>.myshopify.com` — the API host. */
  apiHost: string;
  /** Public Storefront token as found in the site's HTML (env override wins). */
  token: string;
  /** A page whose HTML embeds the token, read only after a 401/403. */
  tokenPage?: string;
  /** Collection handles to read, in order; deduplicated across them. */
  collections: string[];
  /** Public product URL for a handle. */
  productUrl: (handle: string) => string;
  /** Every row's gender when the collection itself decides it (e.g. a women's sale). */
  gender?: ProductRecord["gender"];
  /** Prefix the vendor to the title when the title doesn't carry it (multi-brand retailers). */
  vendorInName?: boolean;
  maxProducts?: number;
}

const API_VERSION = "2024-07";
const PAGE = 100;
const MAX_REQUESTS = Number(process.env.STOREFRONT_MAX_REQUESTS ?? 40);
const PAUSE_MS = Number(process.env.STOREFRONT_PAUSE_MS ?? 400);
const LOW_STOCK = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SALE_QUERY = `query Sale($h: String!, $c: String, $avail: Boolean!, $cc: CountryCode!) @inContext(country: $cc) {
  collection(handle: $h) {
    products(first: ${PAGE}, after: $c, filters: [{ available: $avail }]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title vendor productType availableForSale
        options { name values }
        images(first: 6) { nodes { url } }
        variants(first: 60) {
          nodes {
            availableForSale quantityAvailable
            selectedOptions { name value }
            price { amount currencyCode }
            compareAtPrice { amount }
          }
        }
      }
    }
  }
}`;

const optName = (p: any, re: RegExp): string | null =>
  ((p?.options ?? []) as any[]).map((o) => String(o?.name ?? "")).find((n) => re.test(n)) ?? null;

/** Map one Storefront product node. Pure. */
export function mapSaleStore(store: SaleStore, country: CountryCode, p: any): ProductRecord | null {
  const vs: any[] = p?.variants?.nodes ?? [];
  if (!p?.id || !p?.title || !p?.handle || !vs.length) return null;
  if (/gift ?card|e-?gift/i.test(`${p.title} ${p.productType ?? ""}`)) return null;
  const currency = COUNTRIES[country].currency;
  const priced = vs
    .map((v) => ({
      v,
      price: parseFloat(v?.price?.amount),
      cmp: parseFloat(v?.compareAtPrice?.amount),
      cur: String(v?.price?.currencyCode ?? ""),
    }))
    .filter((x) => x.cur === currency && Number.isFinite(x.price) && x.price > 0);
  if (!priced.length) return null;
  const pick = [...priced].sort(
    (a, b) => Number(!!b.v.availableForSale) - Number(!!a.v.availableForSale) || a.price - b.price,
  )[0];

  const sizeName = optName(p, /size|beden|fit/i);
  const colourName = optName(p, /colou?r|shade/i);
  const valueOf = (v: any, name: string | null) =>
    name ? String((v?.selectedOptions ?? []).find((o: any) => o?.name === name)?.value ?? "").trim() : "";

  const sizes: SizeVariant[] = [];
  if (sizeName) {
    const byLabel = new Map<string, SizeVariant>();
    for (const v of vs) {
      const label = valueOf(v, sizeName);
      if (!label || /default title/i.test(label)) continue;
      const q = Number(v?.quantityAvailable);
      const availability: SizeVariant["availability"] = !v?.availableForSale
        ? "out_of_stock"
        : Number.isFinite(q) && q > 0 && q <= LOW_STOCK
          ? "low_on_stock"
          : "in_stock";
      const prev = byLabel.get(label);
      // Several colours can share a size label: any in-stock one wins.
      if (!prev || (prev.availability === "out_of_stock" && availability !== "out_of_stock")) {
        byLabel.set(label, { label, availability });
      }
    }
    sizes.push(...byLabel.values());
  }
  const colors = colourName ? [...new Set(vs.map((v) => valueOf(v, colourName)).filter(Boolean))] : [];
  const imgs: string[] = (p?.images?.nodes ?? []).map((i: any) => i?.url).filter((u: unknown) => typeof u === "string");
  const title = String(p.title).trim();
  const vendor = String(p.vendor ?? "").trim();
  const name =
    store.vendorInName && vendor && !title.toLowerCase().startsWith(vendor.toLowerCase()) ? `${vendor} ${title}` : title;

  return {
    brand: store.brand,
    country,
    externalId: String(p.id).split("/").pop()!,
    name,
    url: store.productUrl(p.handle),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.price),
    listPrice: Number.isFinite(pick.cmp) && pick.cmp > pick.price ? toMinor(pick.cmp) : null,
    currency,
    inStock: vs.some((v) => v?.availableForSale === true),
    category: typeof p.productType === "string" && p.productType.trim() ? p.productType.trim() : null,
    gender: store.gender ?? null,
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

/** Read the public token out of a storefront page. Pure. */
export function tokenFromHtml(html: string): string | null {
  return html.match(/storefrontAccessToken["']?\s*[:=]\s*["']([a-f0-9]{32})["']/i)?.[1] ?? null;
}

export async function listSaleStore(store: SaleStore, country: CountryCode): Promise<ProductRecord[]> {
  const cap = store.maxProducts ?? 1500;
  let token = store.token;
  let refreshed = false;
  let requests = 0;

  const call = async (variables: Record<string, unknown>): Promise<any> => {
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    const send = () =>
      getJson<any>(`https://${store.apiHost}/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        country,
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
        body: JSON.stringify({ query: SALE_QUERY, variables }),
      });
    try {
      return await send();
    } catch (e) {
      if (refreshed || !store.tokenPage || !/HTTP (401|403)/.test(String(e))) throw e;
      refreshed = true;
      const fresh = tokenFromHtml(await getText(store.tokenPage, { country }).catch(() => ""));
      if (!fresh || fresh === token) throw e;
      token = fresh;
      return send();
    }
  };

  const byId = new Map<string, ProductRecord>();
  const inStock: ProductRecord[] = [];
  const soldOut: ProductRecord[] = [];
  for (const avail of [true, false]) {
    for (const handle of store.collections) {
      let cursor: string | null = null;
      while (inStock.length + soldOut.length < cap && requests < MAX_REQUESTS) {
        const d = await call({ h: handle, c: cursor, avail, cc: country });
        if (d?.errors?.length && !d?.data?.collection) {
          throw new Error(`${store.brand}/${country}: ${String(d.errors[0]?.message ?? "graphql error")}`);
        }
        const conn = d?.data?.collection?.products;
        if (!conn) break; // unknown handle
        for (const p of conn.nodes ?? []) {
          const r = mapSaleStore(store, country, p);
          if (!r || r.listPrice == null || byId.has(r.externalId)) continue;
          byId.set(r.externalId, r);
          (r.inStock ? inStock : soldOut).push(r);
        }
        if (!conn.pageInfo?.hasNextPage) break;
        cursor = conn.pageInfo.endCursor;
      }
    }
  }
  if (process.env.STOREFRONT_DEBUG) console.error(`${store.brand}/${country}: ${requests} requests`);
  return [...inStock, ...soldOut].slice(0, cap);
}
