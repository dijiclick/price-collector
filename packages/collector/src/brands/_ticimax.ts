/**
 * Shared collector for Ticimax storefronts — Bath & Body Works TR, Desa,
 * Elifstil, Note Cosmetics (noteshop.com.tr). Same platform and listing XHR as
 * victoriassecret.ts, generalised (2026-10-11):
 *
 *   GET /api/product/GetProductList?FilterJson=…&PagingJson=…   (100 per page)
 *
 * No proxy: every shop answered a plain request (Cloudflare in front, no
 * challenge) and the GitHub-runner probe reached each home page.
 *
 * PRICES. Each card carries two gross prices (net + `…KDV` VAT):
 *   - `productSellPrice`  — the shelf ("satış") price, the strikethrough,
 *   - `productCartPrice`  — what the basket charges ("indirimli" price).
 * A product is reduced when cart < sell (Desa: 3.790 TL → 1.137 TL, the page
 * shows both). `productPriceOriginal` equals the cart price on every shop
 * measured, so it is NOT an "original" price despite the name.
 *
 * WHICH ROWS. The `IsDiscountedProduct` switch is an admin flag, not a price
 * test: Elifstil had 53 flagged cards but ~160 reduced ones. So a small
 * catalogue (≤ fullWalkMax) is walked whole and filtered on price; a large one
 * (Desa: 5,308) uses the flag to stay inside the request budget.
 *
 * SIZES. The listing's `variantDetails` is empty on these themes, so sizes come
 * from `GetProductVariantDetail` (a colour → size tree with stock per leaf) for
 * a bounded, rotating subset of reduced in-stock items per run.
 *
 * FULL CATALOGUE (Desa, Elifstil, Note — 2026-10-19). Those shops return
 * every in-stock card, discounted or not (full price = `listPrice: null`),
 * because the run's sweep marks every unseen product out of stock. The route
 * honours 250 a page (500 too; 250 is the safer ask), so Desa's 4,769 cards are
 * 20 requests (~40 s), Elifstil 2, Note 4. `MinStockAmount: 1` is NOT an
 * in-stock filter (it drops cards with exactly one left), so the walk is
 * unfiltered and the card's own `inStock` decides. Out-of-stock full-price
 * cards are dropped; discounted ones are kept exactly as before. Bath & Body
 * Works keeps the deals-only walk above.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export interface TicimaxShop {
  brand: string;
  /** Origin, e.g. `https://www.desa.com.tr`. */
  site: string;
  /** Section when the name does not say (Elifstil is a women's shop). */
  defaultGender: ProductRecord["gender"];
  /** Whether items carry sizes worth a detail call (not for cosmetics). */
  sizes: boolean;
  /** Walk the whole catalogue and return full-price in-stock cards too. */
  fullCatalogue?: boolean;
}

export const TICIMAX_SHOPS: Record<string, TicimaxShop> = {
  bathandbodyworks: { brand: "bathandbodyworks", site: "https://www.bathandbodyworks.com.tr", defaultGender: null, sizes: false },
  desa: { brand: "desa", site: "https://www.desa.com.tr", defaultGender: null, sizes: true, fullCatalogue: true },
  elifstil: { brand: "elifstil", site: "https://www.elifstil.com", defaultGender: "kadin", sizes: true, fullCatalogue: true },
  noteshop: { brand: "noteshop", site: "https://www.noteshop.com.tr", defaultGender: null, sizes: false, fullCatalogue: true },
};

const PAGE_SIZE = 100;
const MAX_PRODUCTS = Number(process.env.TICIMAX_MAX_PRODUCTS ?? 1500);
/** A catalogue this small is walked whole (the discount flag misses reduced cards). */
const FULL_WALK_MAX = Number(process.env.TICIMAX_FULL_WALK_MAX ?? 2500);
/** Variant-tree calls per run; together with ≤ 25 listing pages this stays under ~60 requests. */
const DETAIL_LIMIT = Number(process.env.TICIMAX_DETAIL_LIMIT ?? 30);
const PAUSE_MS = Number(process.env.TICIMAX_PAUSE_MS ?? 400);
/** Full-catalogue shops: page size, card cap (Desa 4,769 on 2026-10-19) and extra size calls for full-price cards. */
const FULL_PAGE_SIZE = 250;
const FULL_MAX_PRODUCTS = Number(process.env.TICIMAX_FULL_MAX_PRODUCTS ?? 12000);
const FULL_DETAIL_LIMIT = Number(process.env.TICIMAX_FULL_DETAIL_LIMIT ?? 15);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The filter object the storefront sends, every switch "don't care" (-1). */
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

export function listUrl(site: string, filter: string, page: number, size = PAGE_SIZE): string {
  const q = new URLSearchParams({
    c: "1",
    FilterJson: filter,
    PagingJson: JSON.stringify({ PageItemCount: size, PageNumber: page, OrderBy: "KATEGORISIRA", OrderDirection: "ASC" }),
    CreateFilter: "false",
    TransitionOrder: "0",
    PageType: "1",
    PageId: "0",
  });
  return `${site}/api/product/GetProductList?${q}`;
}

/** Gross (VAT-inclusive) price in major units from a net field and its `…KDV` sibling. */
export const gross = (p: any, field: string): number => Number(p?.[field]) + (Number(p?.[`${field}KDV`]) || 0);

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

export function genderOf(text: string, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const t = fold(text);
  if (/\b(cocuk|bebek|kiz|genc)\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return fallback;
}

/** Map one listing card. Pure. */
export function mapTicimax(shop: TicimaxShop, p: any): ProductRecord | null {
  const shelf = gross(p, "productSellPrice");
  const cart = gross(p, "productCartPrice");
  if (!p?.productId || !p?.name || !Number.isFinite(shelf) || shelf <= 0) return null;
  // A ":" in the shop path (BBW "/stress-relief:-eucalyptus-…-BBW28017586")
  // never opens: Ticimax's ASP.NET rejects it with a 302 to SystemError.aspx,
  // %3A does the same and dropping it is a 404 (2026-10-21; 1 of ~7,300 rows).
  const path = String(p.url ?? p.defaultUrl ?? "");
  if (path.includes(":")) return null;
  const price = Number.isFinite(cart) && cart > 0 ? Math.min(cart, shelf) : shelf;
  const big = (u: unknown) => (typeof u === "string" && u ? u.replace("/UrunResimleri/thumb/", "/UrunResimleri/buyuk/") : null);
  const first = big(p.imageThumbPath) ?? big(p.imageLoadingPath);
  const extra = (p.imageList ?? []).map((im: any) => big(im?.imagePath ?? im?.bigImagePath ?? im));
  const name = String(p.name).trim();
  return {
    brand: shop.brand,
    country: "TR",
    externalId: String(p.productId),
    name,
    url: `${shop.site}${path}`,
    imageUrl: first,
    images: cleanGallery(extra, first),
    price: toMinor(price),
    listPrice: shelf - price > 0.005 ? toMinor(shelf) : null,
    currency: "TRY",
    inStock: p.inStock === true && Number(p.totalStockAmount ?? 1) > 0,
    category: typeof p.category === "string" && p.category.trim() ? p.category.trim() : null,
    gender: genderOf(`${name} ${p.category ?? ""}`, shop.defaultGender),
    variants: null,
    colorName: null,
  };
}

/**
 * Sizes from a `GetProductVariantDetail` tree. Colour levels are dropped from
 * the label (the listing card is already one colour); what is left is the
 * size, or band+cup for two-axis items.
 */
export function treeSizes(tree: any[] | null | undefined): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  const walk = (nodes: any[], path: string[]) => {
    for (const n of nodes ?? []) {
      if (n?.active === false) continue;
      const isColour = /renk|colou?r/i.test(String(n?.typeName ?? n?.additionalOptionVariationTypeName ?? ""));
      const here = isColour ? path : [...path, String(n?.name ?? "").trim()].filter(Boolean);
      const kids: any[] = n?.subVariantValues ?? [];
      if (kids.length) { walk(kids, here); continue; }
      const label = here.length === 2 && /^\d+$/.test(here[0]) && /^[A-Z]{1,4}$/i.test(here[1]) ? here.join("") : here.join(" ");
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, availability: Number(n.stockAmount) > 0 ? "in_stock" : "out_of_stock" });
    }
  };
  walk(tree ?? [], []);
  return out;
}

/** The whole catalogue, 250 cards a page. Any failed page fails the run (a partial walk would sweep live cards). */
async function walkAll(shop: TicimaxShop, pause: () => Promise<void>, count: () => void): Promise<any[]> {
  const filter = filterJson();
  const rows: any[] = [];
  let pages = 1;
  for (let n = 1; n <= pages; n++) {
    if (n > 1) await pause();
    count();
    const d = await getJson<any>(listUrl(shop.site, filter, n, FULL_PAGE_SIZE), { retries: 2 }).catch((e) => {
      throw new Error(`${shop.brand}: product list page ${n} failed (${e?.message ?? e})`);
    });
    if (n === 1) {
      pages = Math.ceil(Number(d?.totalProductCount ?? 0) / FULL_PAGE_SIZE);
      // A cap that cut pages would let the delist sweep mark their cards sold out: refuse instead.
      if (pages * FULL_PAGE_SIZE > FULL_MAX_PRODUCTS) throw new Error(`${shop.brand}: ${d?.totalProductCount} cards, over the cap of ${FULL_MAX_PRODUCTS}`);
    }
    const got: any[] = d?.products ?? [];
    // An empty page before the last is a glitch, not the end: refuse the partial walk.
    if (!got.length) {
      if (n < pages || n === 1) throw new Error(`${shop.brand}: product list page ${n} of ${pages} came back empty`);
      break;
    }
    rows.push(...got);
  }
  return rows;
}

const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let j = a.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [a[j], a[k]] = [a[k], a[j]];
  }
  return a;
};

export async function listTicimax(shop: TicimaxShop, country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  let requests = 0;
  const fetchPage = async (filter: string, n: number) => {
    if (n > 1) await sleep(PAUSE_MS);
    requests++;
    return getJson<any>(listUrl(shop.site, filter, n), { retries: 1 });
  };

  let rows: any[];
  if (shop.fullCatalogue) {
    rows = await walkAll(shop, async () => { await sleep(PAUSE_MS); }, () => requests++);
  } else {
    // Probe the full catalogue's size with the first page of it.
    const all = filterJson();
    const first = await fetchPage(all, 1);
    const total = Number(first?.totalProductCount ?? 0);
    let filter = all;
    rows = [...(first?.products ?? [])];
    let pages = Math.ceil(total / PAGE_SIZE);
    if (total > FULL_WALK_MAX) {
      filter = filterJson({ IsDiscountedProduct: 1 });
      const d = await fetchPage(filter, 1);
      rows = [...(d?.products ?? [])];
      pages = Math.ceil(Number(d?.totalProductCount ?? 0) / PAGE_SIZE);
    }
    pages = Math.min(pages, Math.ceil(FULL_WALK_MAX / PAGE_SIZE));
    for (let n = 2; n <= pages; n++) {
      const d = await fetchPage(filter, n).catch(() => null);
      const got: any[] = d?.products ?? [];
      if (!got.length) break;
      rows.push(...got);
    }
  }

  const byId = new Map<string, ProductRecord>();
  const raw = new Map<string, any>();
  for (const p of rows) {
    const r = mapTicimax(shop, p);
    if (!r || byId.has(r.externalId)) continue;
    // Deals-only shops keep reduced cards; full-catalogue shops also keep in-stock full-price ones.
    if (r.listPrice == null && !(shop.fullCatalogue && r.inStock)) continue;
    byId.set(r.externalId, r);
    raw.set(r.externalId, p);
  }
  const kept = [...byId.values()];
  const deals = kept.filter((r) => r.listPrice != null);
  const full = kept.filter((r) => r.listPrice == null);
  const records = shop.fullCatalogue
    ? [...deals.filter((r) => r.inStock), ...full, ...deals.filter((r) => !r.inStock)].slice(0, FULL_MAX_PRODUCTS)
    : [...deals.filter((r) => r.inStock), ...deals.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);

  if (shop.sizes) {
    // A rotating subset per run: over a few runs every in-stock deal gets its sizes
    // (full-price cards get a smaller share on top).
    const sized = (r: ProductRecord) => r.inStock && raw.get(r.externalId)?.hasVariants !== false;
    const want = [
      ...shuffle(records.filter((r) => r.listPrice != null && sized(r))).slice(0, DETAIL_LIMIT),
      ...(shop.fullCatalogue ? shuffle(records.filter((r) => r.listPrice == null && sized(r))).slice(0, FULL_DETAIL_LIMIT) : []),
    ];
    for (const r of want) {
      await sleep(PAUSE_MS);
      requests++;
      const tree = await getJson<any[]>(`${shop.site}/api/product/GetProductVariantDetail?c=1&productId=${r.externalId}`, { retries: 0 }).catch(() => null);
      const sizes = treeSizes(tree);
      if (!sizes.length) continue;
      r.variants = { colors: [], sizes };
      r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
    }
  }
  if (process.env.TICIMAX_DEBUG) console.error(`${shop.brand}: ${requests} requests, ${rows.length} cards, ${deals.length} deals, ${records.length} rows`);
  return records;
}

/** Registry entry point: `listTicimaxBrand("desa", "TR")`. */
export function listTicimaxBrand(slug: string, country: CountryCode): Promise<ProductRecord[]> {
  const shop = TICIMAX_SHOPS[slug];
  if (!shop) throw new Error(`unknown Ticimax shop ${slug}`);
  return listTicimax(shop, country);
}
