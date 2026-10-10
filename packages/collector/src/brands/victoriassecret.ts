import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Victoria's Secret Turkey — Ticimax. The storefront's own listing XHR,
 * `GET /api/product/GetProductList?FilterJson=…&PagingJson=…`, answers the
 * whole catalogue (8,910 cards, 2026-10-10) with no category at all, 100 per
 * page, and has a server-side `IsDiscountedProduct` filter.
 *
 * On 2026-10-10 that filter returned 0 and four sampled pages held no reduced
 * card either — VS TR promotes through basket offers, not strike prices. So
 * when nothing is discounted the run falls back to the full-price catalogue
 * (capped) to keep sizes trackable; the moment a sale starts it switches to
 * the discounted set by itself.
 *
 * PRICES. `productSellPrice` is NET of VAT; the shelf price is that plus
 * `productSellPriceKDV` (1954.5455 + 195.45455 = the 2.150,00 TL shown).
 *
 * SIZES. The listing's `variantDetails` lists each VALUE once (band 32, cup D)
 * with one representative variant id, so for two-axis items (bras: Bant × Kap)
 * it cannot say which combinations exist. Those go through
 * `GetProductVariantDetail`, a 5 KB tree of band → cups with stock per leaf.
 */
export const SITE = "https://www.victoriassecret.com.tr";
const PAGE_SIZE = 100;
const CONCURRENCY = 3;
const MAX_PRODUCTS = Number(process.env.VICTORIASSECRET_MAX_PRODUCTS ?? 2000);
const DETAIL_LIMIT = Number(process.env.VICTORIASSECRET_DETAIL_LIMIT ?? 500);

export const brand = "victoriassecret";

/** The filter object the storefront sends, with every switch "don't care" (-1). */
export function filterJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    CategoryIdList: [], BrandIdList: [], SupplierIdList: [], TagIdList: [], TagId: -1, FilterObject: [],
    MinStockAmount: -1, IsShowcaseProduct: -1, IsOpportunityProduct: -1, FastShipping: -1, IsNewProduct: -1,
    IsDiscountedProduct: -1, IsShippingFree: -1, IsProductCombine: -1, MinPrice: 0, MaxPrice: 0,
    SearchKeyword: "", StrProductIds: "", IsSimilarProduct: false, RelatedProductId: 0, ProductKeyword: "",
    PageContentId: 0, StrProductIDNotEqual: "", IsVariantList: -1, IsVideoProduct: -1, ShowBlokVideo: -1,
    VideoSetting: { ShowProductVideo: 0, AutoPlayVideo: -1 }, ShowList: 1, VisibleImageCount: 6,
    ShowCounterProduct: -1, ImageSliderActive: false, ProductListPageId: 0, ShowGiftHintActive: false,
    ...over,
  });
}

export function listUrl(filter: string, page: number, size = PAGE_SIZE): string {
  const q = new URLSearchParams({
    c: "1",
    FilterJson: filter,
    PagingJson: JSON.stringify({ PageItemCount: size, PageNumber: page, OrderBy: "KATEGORISIRA", OrderDirection: "ASC" }),
    CreateFilter: "false",
    TransitionOrder: "0",
    PageType: "1",
    PageId: "0",
  });
  return `${SITE}/api/product/GetProductList?${q}`;
}

/** Shelf price incl. VAT, in major units. */
export const gross = (net: unknown, vat: unknown) => Number(net) + (Number(vat) || 0);

/** Sizes from the listing's `variantDetails`, when the item has ONE variant axis. Null for multi-axis items. */
export function singleAxisSizes(details: any[] | null | undefined): SizeVariant[] | null {
  const ds = details ?? [];
  if (!ds.length) return [];
  if (new Set(ds.map((d) => d?.variantTypeId)).size > 1) return null;
  const seen = new Set<string>();
  const out: SizeVariant[] = [];
  for (const d of [...ds].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const label = String(d?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: Number(d.stockAmount) > 0 ? "in_stock" : "out_of_stock" });
  }
  return out;
}

/** "34" + "B" → "34B" (bra band + cup); anything else joins with a space. */
const joinParts = (parts: string[]) =>
  parts.length === 2 && /^\d+$/.test(parts[0]) && /^[A-Z]{1,4}$/i.test(parts[1]) ? parts.join("") : parts.join(" ");

/** Flatten a `GetProductVariantDetail` tree into one size per leaf. */
export function treeSizes(tree: any[] | null | undefined): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  const walk = (nodes: any[], path: string[]) => {
    for (const n of nodes ?? []) {
      if (n?.active === false) continue;
      const here = [...path, String(n?.name ?? "").trim()].filter(Boolean);
      const kids: any[] = n?.subVariantValues ?? [];
      if (kids.length) { walk(kids, here); continue; }
      const label = joinParts(here);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, availability: Number(n.stockAmount) > 0 ? "in_stock" : "out_of_stock" });
    }
  };
  walk(tree ?? [], []);
  return out;
}

/** Map one listing card. Pure. Sizes are left null for two-axis items (filled by the detail pass). */
export function mapVs(p: any): ProductRecord | null {
  const price = gross(p?.productSellPrice, p?.productSellPriceKDV);
  if (!p?.productId || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const original = gross(p.productPriceOriginal, p.productPriceOriginalKDV);
  const big = (u: unknown) => (typeof u === "string" ? u.replace("/UrunResimleri/thumb/", "/UrunResimleri/buyuk/") : null);
  const first = big(p.imageThumbPath) ?? big(p.imageLoadingPath);
  const extra = (p.imageList ?? []).map((im: any) => big(im?.imagePath ?? im?.bigImagePath ?? im));
  const sizes = singleAxisSizes(p.variantDetails);
  return {
    brand,
    country: "TR",
    externalId: String(p.productId),
    name: String(p.name).trim(),
    url: `${SITE}${p.url ?? p.defaultUrl ?? ""}`,
    imageUrl: first,
    images: cleanGallery(extra, first),
    price: toMinor(price),
    listPrice: Number.isFinite(original) && original - price > 0.005 ? toMinor(original) : null,
    currency: "TRY",
    inStock: p.inStock === true && Number(p.totalStockAmount ?? 1) > 0,
    category: p.category ?? null,
    // A women's shop, bar the VS Him fragrance line.
    gender: /erkek|\bhim\b/i.test(`${p.name} ${p.category ?? ""}`) ? "erkek" : "kadin",
    variants: sizes && sizes.length ? { colors: [], sizes } : null,
  };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function walk(filter: string): Promise<{ total: number; rows: any[] }> {
  const first = await getJson<any>(listUrl(filter, 1));
  const total = Number(first?.totalProductCount ?? 0);
  const rows: any[] = [...(first?.products ?? [])];
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), Math.ceil(MAX_PRODUCTS / PAGE_SIZE));
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
  await pool(rest, CONCURRENCY, async (n) => {
    const d = await getJson<any>(listUrl(filter, n)).catch(() => null);
    rows.push(...(d?.products ?? []));
  });
  return { total, rows };
}

export async function listProducts(): Promise<ProductRecord[]> {
  let { rows } = await walk(filterJson({ IsDiscountedProduct: 1 }));
  let records = rows.map(mapVs).filter((r): r is ProductRecord => !!r && r.listPrice != null);
  if (records.length === 0) {
    ({ rows } = await walk(filterJson()));
    records = rows.map(mapVs).filter((r): r is ProductRecord => !!r);
  }
  const byId = new Map(records.map((r) => [r.externalId, r]));
  records = [...byId.values()].slice(0, MAX_PRODUCTS);

  // Two-axis items (bras): the variant tree, a rotating subset per run.
  const multi = rows
    .filter((p) => singleAxisSizes(p?.variantDetails) === null)
    .map((p) => byId.get(String(p.productId)))
    .filter((r): r is ProductRecord => !!r);
  for (let j = multi.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [multi[j], multi[k]] = [multi[k], multi[j]];
  }
  await pool(multi.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    const tree = await getJson<any[]>(`${SITE}/api/product/GetProductVariantDetail?c=1&productId=${r.externalId}`, { retries: 1 }).catch(() => null);
    const sizes = treeSizes(tree);
    if (!sizes.length) return;
    r.variants = { colors: [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}
