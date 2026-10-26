import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { categoryPath, toMinor } from "../normalize";

// Beymen — premium multi-brand store (Vue SPA). The server-rendered category
// page embeds the full first-page product JSON in `window.BEYMEN.productListMain`;
// `sayfa` pages (48/page, no page-size override: `urunSayisi` is ignored, and
// the XHR route `/api/product/list` answers `products: null` to a plain client).
//
// FULL CATALOGUE since 2026-10-19: every page of each tree, discounted rows as
// before and full-price rows with `listPrice: null` — ~181k listings over
// ~3,800 pages (kadin 1,298 · erkek 965 · kozmetik 394 · kids 279 · ev 852).
// That is too slow for a GitHub runner's 4-minute slot, so beymen runs on our
// own box (scripts/collector-host/modadrop-tr-full.*) with a 15-minute budget.
const SITE = "https://www.beymen.com";
// Only women and beauty were crawled, which left two thirds of the discounted
// store untouched — menswear alone holds more reduced items than beauty and
// kids combined. (ev-tekstili is omitted deliberately: it contributes 2 products
// the furniture root doesn't already carry. erkek-10007 is an outlet alias, not
// the menswear root.)
const CATEGORIES: { slug: string; id: number; gender: ProductRecord["gender"] }[] = [
  { slug: "kadin", id: 10006, gender: "kadin" }, // women — 573 pages
  { slug: "erkek", id: 10004, gender: "erkek" }, // men — 454 pages
  { slug: "kozmetik", id: 30894, gender: null }, // beauty — 112 pages
  { slug: "kids", id: 31210, gender: "cocuk" }, // kids — 111 pages
  { slug: "ev-mobilya", id: 96069, gender: null }, // home & furniture — 356 pages
];
// The SSR page carries the full per-page product JSON at any depth. A sustained
// run at 8 workers drew no challenge and no 403, so the old per-page jittered
// sleep is gone. Kept at 8 rather than higher because that is what was proven
// end-to-end, and Imperva may score a datacenter IP differently.
// Per tree; a tree past it THROWS (a capped walk would sell out the rest).
const MAX_PAGES = Number(process.env.BEYMEN_MAX_PAGES ?? 2500);
const PAGE_CONCURRENCY = Number(process.env.BEYMEN_CONCURRENCY ?? 8);

/** Extract the brace-balanced object assigned to `productListMain`. */
function extractListing(html: string): any | null {
  const key = "productListMain = ";
  let i = html.indexOf(key);
  if (i < 0) return null;
  i += key.length;
  const start = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  try {
    return JSON.parse(html.slice(start, i));
  } catch {
    return null;
  }
}

/** Fill a `{width}`/`{height}` image template at the PDP's 645x860 rendition. */
const sized = (u: string) => u.replace("{width}", "645").replace("{height}", "860");

/**
 * The listing's `images[]` IS the product page gallery, in its order (IMG_01,
 * IMG_02... for fashion; MP_<uuid>_1, _2... for marketplace sellers). A Beymen
 * product is one colour (`variant`), so every entry is that colour. Only still
 * images are kept.
 */
export function beymenGallery(images: unknown, first: string | null): string[] | null {
  const list = Array.isArray(images) ? images : [];
  return cleanGallery(
    list
      .filter((u): u is string => typeof u === "string" && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(u))
      .map(sized),
    first,
  );
}

export function mapProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = p?.productId != null ? String(p.productId) : "";
  const price = Number(p?.actualPrice);
  const orig = Number(p?.originalPrice);
  if (!id || !Number.isFinite(price) || price <= 0) return null;
  // `hasDiscount` is the shop's own markdown flag (the sale-only crawl's
  // filter): without it there is no was-price, however originalPrice reads.
  const reduced = p?.hasDiscount === true && Number.isFinite(orig) && orig > price;
  // Image urls are templates with {width}/{height} placeholders.
  const img: string | undefined = p?.images?.[0];
  const imageUrl = img ? sized(img) : null;
  const sizes: SizeVariant[] = (p?.sizes ?? [])
    .map((s: any) => ({
      label: String(s?.sizeName ?? "").trim(),
      availability: (s?.inStock ? "in_stock" : "out_of_stock") as SizeVariant["availability"],
    }))
    .filter((s: SizeVariant) => s.label);
  return {
    brand: "beymen",
    externalId: id,
    name: p?.displayName ?? "",
    url: p?.productUrl ? `${SITE}${p.productUrl}` : SITE,
    imageUrl,
    images: beymenGallery(p?.images, imageUrl),
    price: toMinor(price),
    listPrice: reduced ? toMinor(orig) : null,
    currency: "TRY",
    inStock: p?.isOutOfStock !== true,
    // The shop's own department > group > leaf ("AKSESUAR > GİYİM DIŞI AKSESUAR >
    // GÜNEŞ GÖZLÜĞÜ"), which classifies what no name says — a perfume called
    // "Ivoire Refill 150 ml", a "Panduf" — and marks the furniture, pet, toy and
    // food trees (2026-10-26). Until then this held the designer, now `maker`.
    category: categoryPath([p?.producMainCategory, p?.productSubCategory, p?.productCategory]),
    maker: typeof p?.brandName === "string" && p.brandName.trim() ? p.brandName.trim() : null,
    gender,
    variants: sizes.length > 0 ? { colors: [], sizes } : null,
    // `variant` is this product's colour name; Beymen exposes no sibling colour
    // ids, so we can't safely group colours (only label them).
    colorName: p?.variant ?? null,
  };
}

async function fetchListing(cat: { slug: string; id: number }, page: number, order?: string): Promise<any | null> {
  const url = `${SITE}/tr/${cat.slug}-${cat.id}?sayfa=${page}${order ? `&siralama=${order}` : ""}`;
  const html = await getText(url, { timeoutMs: 60_000 }).catch(() => "");
  return html ? extractListing(html) : null;
}

/**
 * The listing's search index serves 50,000 rows at most: page 1,041 (48/page)
 * is the last real one, page 1,042 answers 500 in every order, and every page
 * past it answers 200 with the SAME fallback rows (measured 2026-10-19 on
 * kadin, 62,286 rows). A tree past the window is therefore walked twice by
 * price — ascending to the window, descending for the rest plus two pages of
 * overlap — and the halves must be shown to meet (the Akinon technique).
 * `artanfiyat`/`azalanfiyat` sort on `promotedOrActualPrice`, so that is the
 * key the meeting check reads.
 */
const ROW_WINDOW = 50_000;
const PAGE_SIZE = 48;
export const WINDOW_PAGES = Math.floor(ROW_WINDOW / PAGE_SIZE); // 1,041

const sortKey = (p: any) => Number(p?.promotedOrActualPrice ?? p?.actualPrice);

export const brand = "beymen";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let seen = new Set<string>();
  const absorb = (listing: any, gender: ProductRecord["gender"]) => {
    for (const p of listing?.products ?? []) {
      if (p?.productId != null) seen.add(String(p.productId));
      const rec = mapProduct(p, gender);
      if (!rec) continue;
      // A product listed in two trees keeps its gendered section over a null one.
      if (!rec.gender) rec.gender = byId.get(rec.externalId)?.gender ?? null;
      byId.set(rec.externalId, rec);
    }
  };

  for (const cat of CATEGORIES) {
    seen = new Set();
    // Page 1 carries totalPage and totalCount, which bound and check the rest.
    // null = Imperva challenge / block / network error: stop the whole run
    // rather than hammer a server that is refusing us — and never hand the
    // collector a partial catalogue, which it would read as a sell-out.
    const first = await fetchListing(cat, 1);
    if (!first) throw new Error(`beymen: ${cat.slug} page 1 failed — partial catalogue refused`);
    const total = Number(first.totalCount) || 0;
    const pages = Math.ceil(total / PAGE_SIZE) || 1;
    if (pages > MAX_PAGES) throw new Error(`beymen: ${cat.slug} has ${pages} pages, over the cap of ${MAX_PAGES}`);

    /** Pages `from..to` in `order`; every one must arrive. Returns the sort keys seen. */
    const walk = async (from: number, to: number, order?: string): Promise<number[]> => {
      const keys: number[] = [];
      const take = (listing: any) => {
        absorb(listing, cat.gender);
        for (const p of listing?.products ?? []) keys.push(sortKey(p));
      };
      const failed: number[] = [];
      const run = (queue: number[], workers: number) =>
        Promise.all(
          Array.from({ length: Math.min(workers, queue.length) }, async () => {
            for (let n = queue.shift(); n != null; n = queue.shift()) {
              const listing = await fetchListing(cat, n, order);
              if (listing) take(listing);
              else failed.push(n);
            }
          }),
        );
      await run(Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => i + from), PAGE_CONCURRENCY);
      // Two more tries for each lost page, a few at a time and after a pause, then refuse.
      for (let round = 1; round <= 2 && failed.length; round++) {
        await new Promise((r) => setTimeout(r, 3000 * round));
        await run(failed.splice(0), 2);
      }
      if (failed.length) throw new Error(`beymen: ${cat.slug} pages ${failed.slice(0, 10).join(",")}${order ? ` (${order})` : ""} failed — partial catalogue refused`);
      return keys.filter(Number.isFinite);
    };

    if (pages <= WINDOW_PAGES) {
      absorb(first, cat.gender);
      await walk(2, pages);
    } else {
      const descPages = Math.ceil((total - WINDOW_PAGES * PAGE_SIZE) / PAGE_SIZE) + 2;
      if (descPages > WINDOW_PAGES) throw new Error(`beymen: ${cat.slug} lists ${total} rows, more than two price-sorted walks reach`);
      const asc = await walk(1, WINDOW_PAGES, "artanfiyat");
      const desc = await walk(1, descPages, "azalanfiyat");
      if (!sortedHalvesMeet(asc.reduce((m, k) => Math.max(m, k), -Infinity), desc.reduce((m, k) => Math.min(m, k), Infinity))) {
        throw new Error(`beymen: ${cat.slug} price-sorted halves do not meet; the walk would miss rows`);
      }
    }
    // Paging a live listing shifts rows between pages mid-walk; more than 1%
    // short of the shop's own count would sell out real stock.
    if (seen.size < total * 0.99) throw new Error(`beymen: ${cat.slug} walk saw ${seen.size} of ${total} products — partial catalogue refused`);
  }
  return [...byId.values()];
}

/**
 * True when an ascending walk whose dearest row is `ascMax` and a descending one
 * whose cheapest row is `descMin` together cover the listing (ties at the
 * boundary can fall either side, hence strictly less).
 */
export function sortedHalvesMeet(ascMax: number, descMin: number): boolean {
  return Number.isFinite(ascMax) && Number.isFinite(descMin) && descMin < ascMax;
}
