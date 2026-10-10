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
 * Sale lists: `/indirim/<section>-…` campaign pages. Their slugs are seasonal
 * ("…-sezon-sonu-firsatlari"), so each run reads the current slug off the
 * section's landing page and only falls back to the last known one.
 */
const SITE = "https://www.defacto.com.tr";
const SECTIONS: { landing: string; fallback: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { landing: "/kadin", fallback: "/indirim/kadin-sezon-sonu-firsatlari", gender: "kadin", pages: 40 },
  { landing: "/erkek", fallback: "/indirim/erkek-sezon-sonu-firsatlari", gender: "erkek", pages: 34 },
  { landing: "/cocuk", fallback: "/indirim/cocuk-sezon-sonu-firsatlari", gender: "cocuk", pages: 10 },
];
const PAGE_SCALE = Number(process.env.DEFACTO_PAGE_SCALE ?? 1);
const MAX_PRODUCTS = Number(process.env.DEFACTO_MAX_PRODUCTS ?? 2000);
const DETAIL_LIMIT = Number(process.env.DEFACTO_DETAIL_LIMIT ?? 250);
const CONCURRENCY = 3;
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

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (const s of SECTIONS) {
    if (byId.size >= MAX_PRODUCTS) break;
    const section = s.landing.slice(1);
    const landing = await get(`${SITE}${s.landing}`);
    const path = findSalePath(landing, section) ?? s.fallback;
    const cap = Math.max(1, Math.round(s.pages * PAGE_SCALE));
    const first = await get(`${SITE}${path}`);
    const total = Number(first.match(/id=product-container data-count=(\d+)/)?.[1] ?? 0);
    const pages = Math.min(cap, Math.max(1, Math.ceil(total / 24)));
    const htmls = [first];
    await pool(Array.from({ length: pages - 1 }, (_, k) => k + 2), CONCURRENCY, async (n) => {
      htmls.push(await get(`${SITE}${path}?page=${n}`));
    });
    for (const html of htmls) {
      for (const { doc, gallery } of parseCards(html)) {
        const rec = mapDocument(doc, gallery, s.gender);
        if (rec && rec.listPrice != null && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
    }
  }
  const records = [...byId.values()].slice(0, MAX_PRODUCTS);

  // Real per-size stock lives on the product page (~160 KB). Rotating subset.
  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  await pool(pick.slice(0, DETAIL_LIMIT), CONCURRENCY, async (r) => {
    const html = await get(r.url);
    const sizes = html ? parsePdpSizes(html) : [];
    if (!sizes.length) return;
    r.variants = { colors: [], sizes };
    r.inStock = sizes.some((x) => x.availability !== "out_of_stock");
  });
  return records;
}
