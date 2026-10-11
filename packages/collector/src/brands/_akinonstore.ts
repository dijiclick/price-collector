/**
 * Multi-brand Akinon stores (FashFed, Sportive): the same listing JSON as a
 * single-brand Akinon shop (see _akinon.ts), plus a brand attribute on every
 * row. The store is collected as its own slug, minus the brands we already
 * collect from their own sites — a FashFed Lacoste polo is the lacoste.com.tr
 * product again, and the same item twice in the feed is noise.
 *
 * Exclusion is done by brand LABEL (codes differ per store: Nike is `017` on
 * FashFed, `02` on Sportive). Where the brand facet is small enough, the walk
 * is narrowed server-side to the wanted brands (Sportive: 3,495 outlet rows →
 * 1,593, 35 pages → 16); FashFed's 287-brand facet would not fit in a URL, so
 * its rows are filtered client-side.
 *
 * Following the Boyner/Beymen convention, a store row's `category` is the
 * product's own brand (the store slug is in `brand`).
 */
import type { ProductRecord, ProductVariants } from "../types";
import { getJson } from "../http";
import { akinonSizes, mapAkinonProduct, pool, type AkinonLimits, type AkinonShop } from "./_akinon";

export interface AkinonStore {
  shop: AkinonShop;
  /** Attribute key holding the brand (`integration_marka`). */
  brandAttr: string;
  /** Brand labels to leave out (compared folded: case, Turkish letters and punctuation ignored). */
  exclude: string[];
  /** Narrow the listing server-side to the non-excluded brands of the facet, when the URL stays short. */
  serverFilter?: boolean;
  /**
   * Other size-group keys some products use instead of `shop.sizeKey`. Sportive
   * groups apparel by `integration_beden` but adidas shoes by `filterable_beden`.
   */
  altSizeKeys?: string[];
}

/** Sizes from a `variants[]` list, trying `shop.sizeKey` then each alternative key. */
export function storeSizes(store: AkinonStore, groups: any[] | null | undefined) {
  for (const sizeKey of [store.shop.sizeKey, ...(store.altSizeKeys ?? [])]) {
    const sizes = akinonSizes(groups, { sizeKey, sizeLabelAttr: store.shop.sizeLabelAttr });
    if (sizes.length) return sizes;
  }
  return [];
}

/** Brands we collect from their own sites (existing adapters + this wave), as stores label them. */
export const DIRECT_BRANDS = [
  "Lacoste", "SuperStep", "Nike", "Jordan", "Puma", "New Balance", "Pierre Cardin", "Network", "İpekyol",
  "Twist", "Mavi", "Colin's", "Koton", "Derimod", "U.S. Polo Assn.", "U.S. Polo", "GAP", "Converse", "Cacharel",
  "GANT", "Guess", "Guess Jeans", "Mudo", "Beymen Club", "Flormar", "M.A.C", "MAC", "Marks & Spencer", "Pandora",
  "Sephora", "Victoria's Secret", "Mango", "Zara", "H&M", "Massimo Dutti", "Penti", "LC Waikiki", "DeFacto",
];

/** Not fashion: kitchen appliances, homeware, toys. */
export const NON_FASHION = [
  "Smeg", "Kitchenaid", "Nespresso", "Delonghi", "Braun", "Funko", "Qua Home", "Mudo Home", "LEXON DESIGN",
  "Airwheel", "Baseus", "Sunnylife",
];

/** `U.S. Polo Assn.` → `uspoloassn`, `İpekyol` → `ipekyol`. */
export const foldBrand = (s: string) =>
  s
    .replace(/[İI]/g, "i")
    .replace(/ı/g, "i")
    .replace(/[Çç]/g, "c")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Öö]/g, "o")
    .replace(/[Üü]/g, "u")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** The row's brand label: `attributes_kwargs[a].label`, else the raw attribute. */
export function storeBrandOf(p: any, attr: string): string | null {
  const kw = p?.attributes_kwargs?.[attr];
  const v = (kw && typeof kw === "object" && kw.label) || p?.attributes?.[attr];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Map one store row; null when unusable or when its brand is excluded. */
export function mapStoreProduct(store: AkinonStore, p: any, excluded = new Set(store.exclude.map(foldBrand))): ProductRecord | null {
  const label = storeBrandOf(p, store.brandAttr);
  if (label && excluded.has(foldBrand(label))) return null;
  // FashFed writes `-` for "no colour" (adidas codes are per colourway already);
  // treat it as colourless so the id is the bare base code, not `KI6678--`.
  const colour = p?.attributes?.[store.shop.colorKey];
  if (typeof colour === "string" && /^[\s-]*$/.test(colour)) {
    p = { ...p, attributes: { ...p.attributes, [store.shop.colorKey]: "" } };
  }
  const r = mapAkinonProduct(store.shop, p);
  if (!r) return null;
  r.category = label ?? r.category ?? null;
  if (!r.variants && store.altSizeKeys?.length) {
    const sizes = storeSizes(store, p.extra_data?.variants);
    if (sizes.length) {
      const colours: any[] = (p.extra_data?.variants ?? []).find((g: any) => g?.attribute_key === store.shop.colorKey)?.options ?? [];
      r.variants = { colors: [...new Set(colours.map((o) => String(o?.label ?? "").trim()).filter(Boolean))], sizes };
      r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
    }
  }
  return r;
}

/** `attributes_<attr>=v1&attributes_<attr>=v2…` for the facet's non-excluded brands, or null. */
export function includeQuery(store: AkinonStore, facets: any[] | null | undefined, excluded: Set<string>): string | null {
  const f = (facets ?? []).find((x) => x?.key === store.brandAttr);
  const choices: any[] = f?.data?.choices ?? [];
  const keep = choices.filter((c) => c?.label && c?.value != null && !excluded.has(foldBrand(String(c.label))));
  if (!keep.length || keep.length === choices.length) return null;
  const key = f.search_key || `attributes_${store.brandAttr}`;
  return keep.map((c) => `${key}=${encodeURIComponent(String(c.value))}`).join("&");
}

const PAGE_SIZE = 100;
const CONCURRENCY = 3;
const MAX_QUERY = 3000;

/**
 * Walk `shop.listPath`, keep DISCOUNTED rows of non-excluded brands, then fill
 * sizes for rows whose listing did not embed them with a bounded, shuffled PDP
 * pass (the upsert keeps earlier variants, so coverage accumulates per run).
 */
export async function listAkinonStore(store: AkinonStore, limits: AkinonLimits): Promise<ProductRecord[]> {
  const { shop } = store;
  const excluded = new Set(store.exclude.map(foldBrand));
  let path = shop.listPath;
  const pageUrl = (n: number) => {
    const sep = path.includes("?") ? "&" : "?";
    return `${shop.site}${path}${sep}format=json&page_size=${PAGE_SIZE}&page=${n}`;
  };

  let first = await getJson<any>(pageUrl(1));
  if (store.serverFilter) {
    const q = includeQuery(store, first?.facets, excluded);
    if (q && q.length <= MAX_QUERY) {
      path = `${path}${path.includes("?") ? "&" : "?"}${q}`;
      first = await getJson<any>(pageUrl(1));
    }
  }

  const sale = new Map<string, ProductRecord>();
  const take = (rows: any[]) => {
    for (const p of rows) {
      if (sale.size >= limits.maxProducts) return;
      const r = mapStoreProduct(store, p, excluded);
      if (r && r.listPrice != null) sale.set(r.externalId, r);
    }
  };
  take(first?.products ?? []);
  const numPages = Math.min(Number(first?.pagination?.num_pages ?? 1), limits.maxPages);
  const pages = Array.from({ length: Math.max(0, numPages - 1) }, (_, i) => i + 2);
  await pool(pages, CONCURRENCY, async (n) => {
    if (sale.size >= limits.maxProducts) return;
    const data = await getJson<any>(pageUrl(n)).catch(() => null);
    take(data?.products ?? []);
  });

  const records = [...sale.values()];
  const missing = records.filter((r) => !r.variants && r.url.startsWith(shop.site) && r.url !== shop.site);
  for (let j = missing.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [missing[j], missing[k]] = [missing[k], missing[j]];
  }
  await pool(missing.slice(0, limits.detailLimit), CONCURRENCY, async (r) => {
    const v = await fetchVariants(store, r.url);
    if (!v) return;
    r.variants = v;
    r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}

async function fetchVariants(store: AkinonStore, url: string): Promise<ProductVariants | null> {
  const sep = url.includes("?") ? "&" : "?";
  const data = await getJson<any>(`${url}${sep}format=json`, { retries: 1 }).catch(() => null);
  const groups: any[] = data?.variants ?? [];
  const sizes = storeSizes(store, groups);
  if (!sizes.length) return null;
  const colours: any[] = groups.find((g) => g?.attribute_key === store.shop.colorKey)?.options ?? [];
  return { colors: [...new Set(colours.map((o) => String(o?.label ?? "").trim()).filter(Boolean))], sizes };
}
