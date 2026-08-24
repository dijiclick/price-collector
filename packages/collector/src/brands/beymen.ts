import type { ProductRecord, SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";

// Beymen — premium multi-brand store (Vue SPA). The server-rendered category
// page embeds the full first-page product JSON in `window.BEYMEN.productListMain`;
// `?indirimliurunler=evet` filters to discounted items, `sayfa` pages (48/page).
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
// The SSR page carries the full per-page product JSON at any depth. The crawl
// was capped at 60 pages, i.e. 10% of womenswear. Full coverage is ~1600 pages,
// which needs a pool; a sustained run at 8 workers drew no challenge and no 403,
// so the old per-page jittered sleep is gone. Kept at 8 rather than higher
// because that is what was proven end-to-end, and CI egress may be scored
// differently by Imperva than a residential IP.
const MAX_PAGES = Number(process.env.BEYMEN_MAX_PAGES ?? 1000);
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

function mapProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = p?.productId != null ? String(p.productId) : "";
  const price = Number(p?.actualPrice);
  const orig = Number(p?.originalPrice);
  if (!id || !Number.isFinite(price) || price <= 0) return null;
  if (!p?.hasDiscount || !(Number.isFinite(orig) && orig > price)) return null;
  // Image urls are templates with {width}/{height} placeholders.
  const img: string | undefined = p?.images?.[0];
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
    imageUrl: img ? img.replace("{width}", "645").replace("{height}", "860") : null,
    price: toMinor(price),
    listPrice: toMinor(orig),
    currency: "TRY",
    inStock: p?.isOutOfStock !== true,
    category: p?.brandName ?? null,
    gender,
    variants: sizes.length > 0 ? { colors: [], sizes } : null,
    // `variant` is this product's colour name; Beymen exposes no sibling colour
    // ids, so we can't safely group colours (only label them).
    colorName: p?.variant ?? null,
  };
}

async function fetchListing(cat: { slug: string; id: number }, page: number): Promise<any | null> {
  const url = `${SITE}/tr/${cat.slug}-${cat.id}?indirimliurunler=evet&sayfa=${page}`;
  const html = await getText(url).catch(() => "");
  return html ? extractListing(html) : null;
}

export const brand = "beymen";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  const absorb = (listing: any, gender: ProductRecord["gender"]) => {
    for (const p of listing?.products ?? []) {
      const rec = mapProduct(p, gender);
      if (!rec) continue;
      // A product listed in two trees keeps its gendered section over a null one.
      if (!rec.gender) rec.gender = byId.get(rec.externalId)?.gender ?? null;
      byId.set(rec.externalId, rec);
    }
  };

  for (const cat of CATEGORIES) {
    // Page 1 carries totalPage, which bounds the rest.
    const first = await fetchListing(cat, 1);
    // null = Imperva challenge / block / network error. Skip this category
    // rather than hammering a server that's already refusing us; the collector
    // flags a brand that returns nothing despite prior stock.
    if (!first) continue;
    absorb(first, cat.gender);

    const pages = Math.min(Number(first.totalPage) || 1, MAX_PAGES);
    let next = 2;
    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, Math.max(0, pages - 1)) }, async () => {
        while (next <= pages) absorb(await fetchListing(cat, next++), cat.gender);
      }),
    );
  }
  return [...byId.values()];
}
