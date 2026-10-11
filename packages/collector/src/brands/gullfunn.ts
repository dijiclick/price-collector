/**
 * Gullfunn (Norwegian jewellery chain) through the GraphQL endpoint its own
 * Astro/Svelte storefront calls, 2026-10-11: `POST www.gullfunn.no/api/graphql`
 * with an Apollo persisted-query hash (search behind it is Voyado Elevate).
 * No key, no cookie, no proxy — the host answered a plain request.
 *
 * The listing query takes `{referer, page, limit, filters, sort, priceRange}`;
 * the sale is the block `/tilbud` (~730 rows) and `limit` 250 is honoured, so a
 * pass over the sale is 3 calls. Each node has `priceRange.from.amount` (NOK,
 * current) and `originalAmount` (struck price), photos, brand and slug.
 *
 * Two facets fill what the card lacks, a few calls each:
 *   - `custom.inOnlineStock` ("Vis kun produkter på nettlager") → inStock;
 *     the rest are store-only or sold out online.
 *   - `department` Dame/Herre/Barn → gender.
 * Ring sizes are listed without stock, so `variants` stays null.
 *
 * The persisted hash changes when the site redeploys a new query. On
 * `PersistedQueryNotFound` it is rediscovered from the live bundle (sale page →
 * listing island → the module exporting the hash), ~3 extra GETs.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "gullfunn";
const ORIGIN = "https://www.gullfunn.no";
const LIST_HASH = "5715e9b18aa5e8a93d74c72f8e43dfbd3f39cb383db56702b8eee4bd4e0ebabb";
const REFERER = "/tilbud";
const LIMIT = 250;
const MAX_PAGES = 6;
const CAP = 1500;
const IN_STOCK = { id: "custom.inOnlineStock", values: ["Vis kun produkter på nettlager"] };
const DEPTS: [string, ProductRecord["gender"]][] = [["Dame", "kadin"], ["Herre", "erkek"], ["Barn", "cocuk"]];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Filter = { id: string; values: string[] };

export function mapGullfunn(n: any, country: CountryCode = "NO"): ProductRecord | null {
  const from = n?.priceRange?.from;
  const price = Number(from?.amount);
  const orig = Number(from?.originalAmount);
  if (!n?.id || !n?.title || !n?.slug || !(price > 0)) return null;
  if (from?.currencyCode && from.currencyCode !== COUNTRIES[country].currency) return null;
  if (from?.isMemberOnly) return null; // a club price is not the shelf price
  const imgs: string[] = (n.media ?? []).map((m: any) => m?.url).filter((u: unknown) => typeof u === "string");
  const maker = String(n.brand?.name ?? "").trim();
  const title = String(n.title).trim();
  const house = /gullfunn|gulldia/i.test(maker);
  return {
    brand,
    country,
    externalId: String(n.id),
    name: maker && !house && !title.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${title}` : title,
    url: `${ORIGIN}/produkter/${n.id}/${n.slug}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: false, // set from the in-stock facet by the lister
    category: null,
    gender: null, // set from the department facet by the lister
    variants: null,
  };
}

/** Find the listing query's persisted hash in the live bundle. */
export async function discoverHash(): Promise<string | null> {
  const html = await getText(`${ORIGIN}/kategori/tilbud`, { country: "NO" });
  const island = /component-url="(\/_astro\/[^"]+\.js)"[^>]*props="[^"]*slugOrSearchQuery/.exec(html)?.[1];
  if (!island) return null;
  const js = await getText(`${ORIGIN}${island}`, { country: "NO" });
  const local = /case"block":\{const\{data:\w+\}=await \w+\(\)\.hash\((\w+)\.HASH/.exec(js)?.[1];
  if (!local) return null;
  const imp = new RegExp(`import\\{([^}]*\\b(\\w+) as ${local}\\b[^}]*)\\}from"\\./([^"]+)"`).exec(js);
  if (!imp) return null;
  const mod = await getText(`${ORIGIN}/_astro/${imp[3]}`, { country: "NO" });
  const exported = imp[2];
  const inner = new RegExp(`(\\w+) as ${exported}\\b`).exec(/export\{([^}]*)\}/.exec(mod)?.[1] ?? "")?.[1] ?? exported;
  return new RegExp(`var ${inner.replace(/\$/g, "\\$")};\\(\\w+=>\\{\\w+\\.HASH="([0-9a-f]{64})"`).exec(mod)?.[1] ?? null;
}

async function query(hash: string, page: number, filters: Filter[]): Promise<any> {
  return getJson<any>(`${ORIGIN}/api/graphql`, {
    method: "POST",
    country: "NO",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      variables: { referer: REFERER, page, limit: LIMIT, filters, sort: "RELEVANCE", priceRange: { from: null, to: null } },
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    }),
  });
}

export async function listGullfunn(country: CountryCode = "NO"): Promise<ProductRecord[]> {
  if (country !== "NO") return [];
  let hash = LIST_HASH;
  const pass = async (filters: Filter[]): Promise<any[]> => {
    const out: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      await sleep(500);
      let res = await query(hash, page, filters);
      if (res?.errors?.some((e: any) => /PersistedQueryNotFound/.test(String(e?.message)))) {
        const found = await discoverHash();
        if (!found || found === hash) throw new Error("gullfunn: listing query hash not found");
        hash = found;
        res = await query(hash, page, filters);
      }
      const p = res?.data?.products;
      if (!p) throw new Error(`gullfunn: no products (${JSON.stringify(res?.errors ?? null).slice(0, 200)})`);
      const nodes: any[] = p.nodes ?? [];
      out.push(...nodes);
      if (!nodes.length || !p.pageInfo?.hasNextPage || page * LIMIT >= Number(p.totalCount ?? 0)) break;
    }
    return out;
  };

  const byId = new Map<string, ProductRecord>();
  for (const n of await pass([])) {
    const r = mapGullfunn(n, country);
    if (r && r.listPrice != null) byId.set(r.externalId, r);
  }
  for (const n of await pass([IN_STOCK])) {
    const r = byId.get(String(n?.id));
    if (r) r.inStock = true;
  }
  const depts = new Map<string, Set<ProductRecord["gender"]>>();
  for (const [dept, gender] of DEPTS) {
    for (const n of await pass([{ id: "department", values: [dept] }])) {
      const id = String(n?.id);
      if (!depts.has(id)) depts.set(id, new Set());
      depts.get(id)!.add(gender);
    }
  }
  for (const [id, set] of depts) {
    const r = byId.get(id);
    if (r && set.size === 1) r.gender = [...set][0]; // in two departments → unisex, stays null
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listGullfunn;
