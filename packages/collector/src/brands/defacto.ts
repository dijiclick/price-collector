import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { toMinor } from "../normalize";
import { browserText, decodeEntities, extractJsonAfter } from "../../../../lib/live-brands/_browser";

/**
 * DeFacto (defacto.com.tr). Akamai answers 403 to Node's default fetch, curl
 * and HTTP/1.1 generally; the shared browser-shaped HTTP/2 fetch gets 200
 * (measured 2026-10-10). The site is server-rendered: every listing card
 * carries its product as JSON in `data-documents` — name, prices, colour,
 * category, stock and every size with its EAN-13 — 24 cards per `?page=N`.
 *
 * FULL CATALOGUE (2026-10-19): each section's "tümü" root — `/kadin-tumu`
 * (11,306), `/erkek-tumu` (6,285), `/cocuk-tumu` (5,416) — 23k rows on ~960
 * pages of 24 (no page-size override exists: the scroll XHR
 * `/Catalog/PartialIndexScrollResult` is 24 too). Discounted rows come out of
 * the same card JSON and the same `defactoPrice` as the `/indirim/…` sale
 * lists did, so they are unchanged; full-price rows carry `listPrice: null`.
 * Measured from the Mac 2026-10-19: 22,992 rows, 958 pages in 142s at
 * concurrency 3, then the PDP pass; a runner answers a deep page in 0.6–1.2s
 * (probe run 39298495016), so listing pages go 4 at a time and the PDP pass
 * stops starting pages at 180s. A page that fails twice fails the run: a
 * partial walk would let the delist sweep mark the rest sold out.
 * (`findSalePath` is kept for the sale-list slug, no longer walked.)
 */
const SITE = "https://www.defacto.com.tr";
const SECTIONS: { path: string; gender: ProductRecord["gender"] }[] = [
  { path: "/kadin-tumu", gender: "kadin" },
  { path: "/erkek-tumu", gender: "erkek" },
  { path: "/cocuk-tumu", gender: "cocuk" },
];
const PAGE_SIZE = 24;
// Headroom over the ~960-page / 23k-row catalogue: a cap must never cut it,
// or the collector's sweep would mark the cut rows sold out.
const MAX_PAGES = Number(process.env.DEFACTO_MAX_PAGES ?? 3000);
const DETAIL_LIMIT = Number(process.env.DEFACTO_DETAIL_LIMIT ?? 250);
/** No product page is STARTED after this (ms since the run began). */
const DETAIL_DEADLINE_MS = Number(process.env.DEFACTO_DETAIL_DEADLINE_MS ?? 180_000);
const CONCURRENCY = 3;
/** Listing pages in flight (the PDP pass keeps CONCURRENCY). */
const LIST_CONCURRENCY = Number(process.env.DEFACTO_LIST_CONCURRENCY ?? 4);
const get = (url: string) => browserText(url, { timeoutMs: 30000 }).then((t) => t ?? "");

const IMG = (file: string, w = 768) => `https://dfcdn.defacto.com.tr/${w}/${file}`;

const genderOf = (sub: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] => {
  const s = String(sub ?? "").toLowerCase();
  if (/girl|boy|kid|baby|child/.test(s)) return "cocuk";
  if (s === "woman" || s === "women") return "kadin";
  if (s === "man" || s === "men") return "erkek";
  return fallback;
};

/**
 * DeFacto prices (surveyed 2026-10-10):
 * - `Price` is the original, `DiscountedPrice` the shelf price (equal when
 *   there is no markdown).
 * - `CampaignDiscountedPrice` (= `CampaignBadge.DiscountPrice`, description
 *   "Sepette") is an automatic basket price: no code or minimum, applied to
 *   every basket, printed under the shelf price. Same rule as Boyner's
 *   `inBasketWithDiscount` and LCW: that is what a shopper pays.
 * The product page's DataLayer carries the same three fields, so the resolver
 * and the collector agree on one row.
 */
export function defactoPrice(d: any): { price: number; listPrice: number | null } | null {
  const orig = Number(d?.Price);
  const shelf = Number(d?.DiscountedPrice) > 0 ? Number(d.DiscountedPrice) : orig;
  if (!Number.isFinite(shelf) || shelf <= 0) return null;
  const camp = Number(d?.CampaignDiscountedPrice ?? d?.CampaignBadge?.DiscountPrice);
  const price = Number.isFinite(camp) && camp > 0 && camp < shelf ? camp : shelf;
  const was = Math.max(Number.isFinite(orig) ? orig : 0, shelf);
  return { price, listPrice: was > price ? was : null };
}

/** Listing cards list sizes in no particular order; show them S → XL, 34 → 44. */
const LADDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];
export function sizeRank(label: string): number {
  const i = LADDER.indexOf(label.toUpperCase());
  if (i >= 0) return i;
  const n = parseFloat(label);
  return Number.isFinite(n) ? 100 + n : 1000;
}

/** One `data-documents` object (+ its card's gallery) → a record. */
export function mapDocument(d: any, gallery: string[], fallback: ProductRecord["gender"]): ProductRecord | null {
  const idx = d?.ProductVariantIndex;
  const pr = defactoPrice(d);
  if (!idx || !pr || !d.SeoName) return null;
  const files = gallery.length ? gallery : d.PictureName ? [d.PictureName] : [];
  const shots = files.map((f) => IMG(f));
  const barcodes = [...new Set((d.Sizes ?? [])
    .map((s: any) => String(s?.Barcode ?? "").replace(/\D/g, ""))
    .filter((b: string) => b.length >= 8 && b.length <= 14))] as string[];
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of d.Sizes ?? []) {
    const label = String(s?.SizeName ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    // Listing sizes carry no per-size stock (StockQuantity is null): the card
    // shows what the shop offers. Product pages refine this for a subset.
    sizes.push({ label, availability: s?.StockQuantity === 0 ? "out_of_stock" : "in_stock" });
  }
  sizes.sort((a, b) => sizeRank(a.label) - sizeRank(b.label));
  const code = String(d.LongCode ?? "").match(/^[A-Z]\d{4}[A-Z]{2}/)?.[0];
  return {
    brand: "defacto",
    country: "TR",
    externalId: String(idx),
    barcodes: barcodes.length ? barcodes : null,
    name: decodeEntities(String(d.Name ?? "")).trim(),
    url: `${SITE}/${d.SeoName}-${idx}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots),
    price: toMinor(pr.price),
    listPrice: pr.listPrice != null ? toMinor(pr.listPrice) : null,
    currency: "TRY",
    inStock: Number(d.Stock ?? 1) > 0,
    category: d.CategoryName ?? d.ProductType ?? null,
    gender: genderOf(d.SubDivision, fallback),
    variants: sizes.length ? { colors: [], sizes } : null,
    // The model code (e.g. "G6884AX") is shared by every colour of a product.
    groupKey: code ? `defacto:${code}` : null,
    colorName: d.ColorName ?? null,
  };
}

/** Cards on a listing page: the `data-documents` JSON and its gallery files. */
export function parseCards(html: string): { doc: any; gallery: string[] }[] {
  const out: { doc: any; gallery: string[] }[] = [];
  const parts = html.split(/data-documents='/).slice(1);
  for (const part of parts) {
    const end = part.indexOf("'");
    if (end < 0) continue;
    let doc: any;
    try { doc = JSON.parse(decodeEntities(part.slice(0, end))); } catch { continue; }
    const g = part.match(/window\.productImage\d+=/);
    const imgs = g ? (extractJsonAfter(part, g[0]) as any[] | null) : null;
    const gallery = (imgs ?? [])
      .filter((x) => x?.isProductImage !== false && typeof x?.imagePath === "string")
      .map((x) => x.imagePath as string)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    out.push({ doc, gallery });
  }
  return out;
}

/** The current sale-list path linked from a section landing page. */
export function findSalePath(html: string, section: string): string | null {
  const m = html.match(new RegExp(`href="?(/indirim/${section}[a-z0-9-]*)`));
  return m?.[1] ?? null;
}

/** Per-size stock from a product page's `PRODUCT_DETAIL_SIZE_DATA=[…]`. */
export function parsePdpSizes(html: string): SizeVariant[] {
  // The page first declares `var PRODUCT_DETAIL_SIZE_DATA="";`, then assigns
  // the array — anchor on the assignment.
  const at = html.indexOf("PRODUCT_DETAIL_SIZE_DATA=[");
  const arr = at < 0 ? null : extractJsonAfter(html, "PRODUCT_DETAIL_SIZE_DATA=", at);
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(arr) ? arr : []) {
    const label = [s?.Size, s?.Length].filter(Boolean).join("/").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(s?.StockQuantity);
    out.push({ label, availability: !(q > 0) ? "out_of_stock" : q <= 2 ? "low_on_stock" : "in_stock" });
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export const brand = "defacto";

/** Total row count a listing page reports (`#product-container data-count`). */
export function listingCount(html: string): number {
  return Number(html.match(/id=product-container data-count=(\d+)/)?.[1] ?? 0);
}

export async function listProducts(): Promise<ProductRecord[]> {
  const t0 = Date.now();
  const byId = new Map<string, ProductRecord>();
  const take = (html: string, gender: ProductRecord["gender"]) => {
    for (const { doc, gallery } of parseCards(html)) {
      const rec = mapDocument(doc, gallery, gender);
      if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
    }
  };
  for (const s of SECTIONS) {
    const first = await get(`${SITE}${s.path}`);
    const total = listingCount(first);
    // A page without cards is a refusal or an error page, not an empty listing.
    if (!total || !parseCards(first).length) throw new Error(`defacto: ${s.path} unreadable — partial catalogue refused`);
    take(first, s.gender);
    const pages = Math.ceil(total / PAGE_SIZE);
    // A cap that cut pages would let the delist sweep mark their rows sold out: refuse instead.
    if (pages > MAX_PAGES) throw new Error(`defacto: ${s.path} has ${pages} pages, over the cap of ${MAX_PAGES}`);
    const failed: number[] = [];
    const page = async (n: number) => {
      const html = await get(`${SITE}${s.path}?page=${n}`);
      if (parseCards(html).length) take(html, s.gender);
      // A real listing page with no cards is the tail shrinking mid-walk.
      else if (!listingCount(html)) failed.push(n);
    };
    await pool(Array.from({ length: pages - 1 }, (_, k) => k + 2), LIST_CONCURRENCY, page);
    // A lost page is 24 rows the collector would mark sold out: one more try
    // each, then refuse a partial catalogue rather than return it.
    const retry = failed.splice(0);
    for (const n of retry) await page(n);
    if (failed.length) throw new Error(`defacto: ${s.path} pages ${failed.join(",")} failed — partial catalogue refused`);
  }
  const records = [...byId.values()];
  const listedAt = Date.now();

  // Real per-size stock lives on the product page (~160 KB). Rotating subset.
  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  let details = 0;
  await pool(pick.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    // The listing is the catalogue; per-size stock is an enrichment and must
    // never push the brand past its time budget.
    if (Date.now() - t0 > DETAIL_DEADLINE_MS) return;
    details++;
    const html = await get(r.url);
    const sizes = html ? parsePdpSizes(html) : [];
    if (!sizes.length) return;
    r.variants = { colors: [], sizes };
    r.inStock = sizes.some((x) => x.availability !== "out_of_stock");
  });
  console.log(
    `defacto: ${records.length} rows in ${((listedAt - t0) / 1000).toFixed(0)}s, ` +
      `${details} product pages in ${((Date.now() - listedAt) / 1000).toFixed(0)}s`,
  );
  return records;
}
