/**
 * Manor — Switzerland's department store (www.manor.ch), added 2026-10-11.
 *
 * The Next.js storefront talks to a public GraphQL API at
 * `https://ecom-api.manor.ch/graphql` (no auth, no cookies, no bot wall — it
 * answers a plain POST). Two calls do the work:
 *
 *  - `searchProducts(input)` — the Algolia-backed lister. The site's own Sale
 *    pages are `collection = specialprice` + `specialBrandCategory = woman | men
 *    | kids`; walking the three slices gives each row an exact gender. Hits carry
 *    `priceValue`/`originalPrice` in CHF, one hit per colour (its `code` is one
 *    size SKU). Two traps: Algolia stops at 1,000 hits per query, and with
 *    `orderBy: NOT_SPECIFIED` the order is NOT stable between pages (the same
 *    hit comes back on several pages) — `NEW` is stable and puts in-stock first.
 *  - `productById(id)` — the PDP's per-size list (`variantSizes{size sellable}`).
 *    There is no batch endpoint, so ids are batched as GraphQL aliases, 50 per
 *    request, three requests in flight. The server spends ~0.2 s per product, so it runs
 *    under a time budget; rows it does not reach keep only their colour.
 *
 * Marketplace offers (`mp-…` codes) always read `OUT_OF_STOCK` in the search
 * index although their PDP is purchasable — the index tracks Manor's own stock
 * only — so they are counted as in stock.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const API = "https://ecom-api.manor.ch/graphql";
const SITE = "https://www.manor.ch";
const PAGE_SIZE = 200;
const BATCH = 50;
const PAUSE_MS = Number(process.env.MANOR_PAUSE_MS ?? 500);
/** Seconds the per-size enrichment may take before the rest ships without sizes. */
const SIZE_BUDGET_MS = Number(process.env.MANOR_SIZE_BUDGET_MS ?? 100_000);

export const MANOR_SALE: { segment: string; gender: ProductRecord["gender"] }[] = [
  { segment: "woman", gender: "kadin" },
  { segment: "men", gender: "erkek" },
  { segment: "kids", gender: "cocuk" },
];

export const SEARCH_QUERY =
  "query S($input:InputSearch!){searchProducts(input:$input){totalResults page totalPages products{" +
  "code baseCode name brandName color size link titles{first second} priceValue{currency amount} " +
  "originalPrice{amount} uvpPrice{amount} stock{level status} imageUrls{desktop} productBreadcrumbPath}}}";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Amplience image id → a 900px rendition. */
export function manorImage(u: unknown): string | null {
  if (typeof u !== "string" || !/^https?:\/\//.test(u)) return null;
  return u.includes("?") ? u : `${u}?w=900&fmt=auto`;
}

/** Leaf of `woman/woman-clothing/woman-tailor/woman-blazer`, without its gender prefix. */
function leafType(paths: unknown): string | null {
  const p = Array.isArray(paths) && typeof paths[0] === "string" ? paths[0] : "";
  const leaf = p.split("/").pop() ?? "";
  const t = leaf.replace(/^(woman|men|kids|girls?|boys?|baby)-/, "").replace(/-/g, " ").trim();
  return t || null;
}

/** Map one search hit. Only DISCOUNTED hits (price below original/UVP) are returned. Pure. */
export function mapManor(country: CountryCode, p: any, gender: ProductRecord["gender"] = null): ProductRecord | null {
  const code = typeof p?.code === "string" ? p.code : "";
  const price = Number(p?.priceValue?.amount);
  if (!code || !Number.isFinite(price) || price <= 0) return null;
  const was = [p?.originalPrice?.amount, p?.uvpPrice?.amount].map(Number).filter((v) => Number.isFinite(v) && v > price);
  if (!was.length) return null;
  const listPrice = Math.min(...was);
  const title = String(p?.titles?.second ?? "").trim() || String(p?.name ?? "").trim();
  if (!title) return null;
  const brand = String(p?.brandName ?? p?.titles?.first ?? "").trim() || null;
  const imageUrl = manorImage(p?.imageUrls?.desktop);
  const marketplace = code.startsWith("mp-");
  const colorName = typeof p?.color === "string" && p.color.trim() ? p.color.trim() : null;
  return {
    brand: "manor",
    country,
    externalId: code,
    name: title,
    url: typeof p?.link === "string" && p.link.startsWith("http") ? p.link : `${SITE}/p/${code}`,
    imageUrl,
    images: cleanGallery([imageUrl], imageUrl),
    price: toMinor(price),
    listPrice: toMinor(listPrice),
    currency: String(p?.priceValue?.currency ?? "CHF"),
    inStock: marketplace || p?.stock?.status !== "OUT_OF_STOCK",
    // Multi-brand store: the label shows the brand (same as Boyner/Beymen).
    category: brand ?? leafType(p?.productBreadcrumbPath),
    gender,
    variants: colorName ? { colors: [colorName], sizes: [] } : null,
    groupKey: typeof p?.baseCode === "string" && p.baseCode ? `manor:${p.baseCode.toLowerCase()}` : null,
    colorName,
  };
}

/** `variantSizes` of one PDP → our sizes. "Onesize" is not a size anyone picks. */
export function manorSizes(variantSizes: unknown): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(variantSizes) ? variantSizes : []) {
    const label = String(s?.size ?? "").trim();
    if (!label || /^one ?size$/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: s?.sellable === false ? "out_of_stock" : "in_stock" });
  }
  return out;
}

async function gql(body: unknown): Promise<any> {
  return getJson<any>(API, {
    method: "POST",
    country: "CH",
    headers: { "Content-Type": "application/json", "Accept-Language": "de", Origin: SITE },
    body: JSON.stringify(body),
  });
}

async function searchPage(segment: string, page: number): Promise<any[] | null> {
  const data = await gql({
    query: SEARCH_QUERY,
    variables: {
      input: {
        numericFilters: [],
        orderBy: "NEW",
        page,
        pageSize: PAGE_SIZE,
        selectedFilters: [
          { facetName: "collection", facetValues: ["specialprice"] },
          { facetName: "specialBrandCategory", facetValues: [segment] },
        ],
      },
    },
  }).catch(() => null);
  const ps = data?.data?.searchProducts?.products;
  return Array.isArray(ps) ? ps : null;
}

/** Fill per-size stock for `rows` (Manor's own SKUs) in aliased batches, within the time budget. */
async function enrichSizes(rows: ProductRecord[], concurrency = 3): Promise<void> {
  const started = Date.now();
  const chunks: ProductRecord[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) chunks.push(rows.slice(i, i + BATCH));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
      while (next < chunks.length && Date.now() - started < SIZE_BUDGET_MS) {
        const chunk = chunks[next++];
        const q = chunk
          .map((r, j) => `p${j}:productById(id:${JSON.stringify(r.externalId)}){code variantSizes{size sellable}}`)
          .join(" ");
        const data = await gql({ query: `{${q}}` }).catch(() => null);
        chunk.forEach((r, j) => {
          const sizes = manorSizes(data?.data?.[`p${j}`]?.variantSizes);
          if (!sizes.length) return;
          r.variants = { colors: r.variants?.colors ?? [], sizes };
        });
        await sleep(PAUSE_MS);
      }
    }),
  );
}

export async function listManor(country: CountryCode, maxProducts = 1500): Promise<ProductRecord[]> {
  if (country !== "CH") return [];
  const byId = new Map<string, ProductRecord>();
  const streams = MANOR_SALE.map((s) => ({ ...s, page: 0, done: false }));
  // Round-robin the slices so the cap is not spent on women's alone.
  // Algolia serves at most 1,000 hits per query = 5 pages of 200.
  while (byId.size < maxProducts * 1.2 && streams.some((s) => !s.done)) {
    for (const s of streams) {
      if (s.done) continue;
      const ps = await searchPage(s.segment, s.page++);
      if (ps === null && byId.size === 0 && s.page === 1 && s.segment === "woman") {
        throw new Error(`manor/${country}: searchProducts refused`);
      }
      if (!ps || ps.length === 0 || s.page >= 1000 / PAGE_SIZE) s.done = true;
      for (const p of ps ?? []) {
        const r = mapManor(country, p, s.gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      await sleep(PAUSE_MS);
    }
  }
  const all = [...byId.values()];
  const picked = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, maxProducts);
  // Sizes only matter where Manor holds the stock; marketplace offers are one-offs.
  await enrichSizes(picked.filter((r) => !r.externalId.startsWith("mp-")));
  return picked;
}

export const listProducts = (country: CountryCode): Promise<ProductRecord[]> => listManor(country);
