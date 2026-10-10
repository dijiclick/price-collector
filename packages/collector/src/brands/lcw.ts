import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant } from "../types";
import { toMinor } from "../normalize";
import { browserText, decodeEntities, extractJsonAfter, trMoney } from "../../../../lib/live-brands/_browser";

/**
 * LC Waikiki (lcw.com). The storefront server-renders every listing page with
 * the whole result set inlined as `var catalogModel = {…}` — the same object
 * its own `/tr/ajax/ProductList/ProductListPageData` XHR returns — so one plain
 * GET per page of 100 is the whole crawl. No auth — but Akamai answers 403 to
 * Node's default HTTP/1.1 fetch (curl passes), so requests go through the
 * shared browser-shaped HTTP/2 fetch (measured 2026-10-10).
 *
 * Sources, both discounted by construction:
 * - `kampanyalar/kadin-indirimli-urunler-lcw` — the women's sale tag (~5k).
 * - `outlet/erkek-giyim-t-9` — men's outlet; there is no men's sale tag, and
 *   outlet rows carry the same strike/basket prices.
 * The outlet tree mixes in marketplace sellers (other brands sold on lcw.com);
 * only rows sold by LC Waikiki itself are kept.
 */
const SITE = "https://www.lcw.com";

const SOURCES: { path: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { path: "/kampanyalar/kadin-indirimli-urunler-lcw", gender: "kadin", pages: 12 },
  { path: "/outlet/erkek-giyim-t-9", gender: "erkek", pages: 7 },
];
const PAGE_SCALE = Number(process.env.LCW_PAGE_SCALE ?? 1);
const MAX_PRODUCTS = Number(process.env.LCW_MAX_PRODUCTS ?? 2000);
const DETAIL_LIMIT = Number(process.env.LCW_DETAIL_LIMIT ?? 200);
const CONCURRENCY = 3;
const get = (url: string) => browserText(url, { timeoutMs: 30000 }).then((t) => t ?? "");

const genderOf = (level1: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] => {
  const s = String(level1 ?? "").toLocaleLowerCase("tr");
  if (/çocuk|bebek|genç/.test(s)) return "cocuk";
  if (s.startsWith("kad")) return "kadin";
  if (s.startsWith("erkek")) return "erkek";
  return fallback;
};

/**
 * LCW prices (surveyed 2026-10-10 on the sale tag):
 * - `PriceValue` is the shelf price, `OldPrice` the struck-through one (equal
 *   to `Price` when there is no markdown).
 * - `CampaignBadges[].DiscountedPrice` with Description "Sepette İndirim" is an
 *   automatic basket price — no code, card or minimum — and it is the price
 *   the product page's own schema.org Offer quotes (649.99 for a 699.99/799.99
 *   item). Same rule as Boyner's `inBasketWithDiscount`: that is what is paid.
 */
export function lcwPrice(x: any): { price: number; listPrice: number | null } | null {
  const shelf = Number(x?.PriceValue);
  if (!Number.isFinite(shelf) || shelf <= 0) return null;
  const basket = (x?.CampaignBadges ?? [])
    .map((b: any) => (b?.ShowDiscountedPrice === false ? NaN : Number(b?.DiscountedPrice)))
    .find((v: number) => Number.isFinite(v) && v > 0 && v < shelf);
  const price = basket ?? shelf;
  const was = Math.max(trMoney(x?.OldPrice) || 0, shelf);
  return { price, listPrice: was > price ? was : null };
}

export function mapItem(x: any, fallback: ProductRecord["gender"]): ProductRecord | null {
  const id = x?.OptionId;
  const pr = lcwPrice(x);
  if (!id || !pr || !x.ModelUrl) return null;
  const shots: string[] = (x.OptionImageList ?? [])
    .map((im: any) => im?.ExtraLargeImage ?? im?.LargeImage)
    .filter((u: unknown) => typeof u === "string");
  const first: string | null = shots[0] ?? x.DefaultOptionImageUrl ?? null;
  const bc = x.BreadCrump ?? {};
  return {
    brand: "lcw",
    country: "TR",
    externalId: String(id),
    name: decodeEntities(String(x.ProductDescription ?? "")).trim(),
    url: `${SITE}${x.ModelUrl}`,
    imageUrl: first,
    images: cleanGallery(shots.length ? shots : (x.OptionImageUrlList ?? []), first),
    price: toMinor(pr.price),
    listPrice: pr.listPrice != null ? toMinor(pr.listPrice) : null,
    currency: "TRY",
    inStock: Number(x.AvailableStock ?? 1) > 0,
    category: bc.Level4 ?? bc.Level3 ?? x.Category ?? null,
    gender: genderOf(bc.Level1, fallback),
    // Every colour of one model shares ModelId; the shop's own swatch grouping.
    groupKey: x.ModelId ? `lcw:${x.ModelId}` : null,
    colorName: null,
  };
}

/** Listing page → its items and page count. */
export function parseListing(html: string): { items: any[]; pageCount: number } {
  const model = extractJsonAfter(html, "var catalogModel =") as any;
  const list = model?.CatalogList ?? {};
  return { items: list.Items ?? [], pageCount: Number(model?.PageView?.PageCount ?? list.PageCount ?? 1) };
}

/** Split a JS argument list on top-level commas, unquoting '…' strings. */
function jsArgs(src: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && q) { cur += src[++i] ?? ""; continue; }
    if (c === "'") { q = !q; continue; }
    if (c === "," && !q) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Per-size stock from a product page. The page builds its size picker from
 * `new SingleSizeProduct(optionId, productId, sizeId, 'XL', order, stock,
 * 'price', '…', 'oldPrice', 'TL', '…', 'True')` calls — the sixth argument is
 * the live stock count. Only the sizes of `optionId` (the colour) are kept.
 */
export function parseSizes(html: string, optionId?: string): SizeVariant[] {
  const rows: { order: number; v: SizeVariant }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/new SingleSizeProduct\(([^)]*)\)/g)) {
    const a = jsArgs(m[1]);
    if (optionId && a[0] !== optionId) continue;
    const label = decodeEntities(a[3] ?? "").trim();
    const stock = Number(a[5]);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    rows.push({
      order: Number(a[4]) || 0, // the picker's display order (S before XL)
      v: { label, availability: !(stock > 0) ? "out_of_stock" : stock <= 2 ? "low_on_stock" : "in_stock" },
    });
  }
  return rows.sort((x, y) => x.order - y.order).map((r) => r.v);
}

/** The colour name the page passes to `new Option(id, 'name', 'code', …)`. */
export function parseColour(html: string, optionId: string): string | null {
  const m = html.match(new RegExp(`new Option\\(${optionId}\\s*,\\s*'([^']*)'`));
  return m ? decodeEntities(m[1]).trim() || null : null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export const brand = "lcw";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (const src of SOURCES) {
    const cap = Math.max(1, Math.round(src.pages * PAGE_SCALE));
    const first = await get(`${SITE}${src.path}`);
    const { items, pageCount } = parseListing(first);
    const pages = [items];
    const rest = Array.from({ length: Math.min(cap, pageCount) - 1 }, (_, k) => k + 2);
    const got: any[][] = [];
    await pool(rest, CONCURRENCY, async (n) => {
      const html = await get(`${SITE}${src.path}?sayfa=${n}`);
      got.push(parseListing(html).items);
    });
    pages.push(...got);
    for (const list of pages) {
      for (const x of list) {
        // Marketplace sellers are other brands; LC Waikiki itself is supplier 1.
        if (x?.SupplierId !== 1 && x?.SupplierStoreName !== "LC Waikiki") continue;
        const rec = mapItem(x, src.gender);
        if (rec && rec.listPrice != null && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
    }
  }
  const records = [...byId.values()].slice(0, MAX_PRODUCTS);

  // Listings carry no sizes; each needs its product page (~550 KB). Cover a
  // rotating random subset per run — the upsert keeps earlier captures, so
  // coverage accumulates — and leave the rest null so nothing is erased.
  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  await pool(pick.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    const html = await get(r.url);
    if (!html) return;
    const sizes = parseSizes(html, r.externalId);
    if (sizes.length) {
      r.variants = { colors: [], sizes } satisfies ProductVariants;
      r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
    }
    r.colorName = parseColour(html, r.externalId);
  });
  return records;
}
