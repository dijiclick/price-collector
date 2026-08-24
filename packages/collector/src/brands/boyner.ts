import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

// Boyner — big Turkish multi-brand store. Its mobile listing API (same host the
// app uses) is public — no auth, just an app-style UA. OrderOption=Sale ranks by
// discount, so we page the top-discount products per category.
const API = "https://mpcore-listingsearch-prod.boyner.com.tr/api/v2/product/search";
const SITE = "https://www.boyner.com.tr";
const CATEGORIES = [1, 4]; // Kadın (women), Kozmetik (beauty)
// CategoryID is the section: 1 is the women's tree; 4 (beauty) carries no gender.
const CATEGORY_GENDER: Record<number, ProductRecord["gender"]> = { 1: "kadin", 4: null };
const MAX_PAGES = Number(process.env.BOYNER_MAX_PAGES ?? 3000);
const HEADERS = { "User-Agent": "okhttp/4.12.0" }; // mimic the app client

const LETTER_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
function sizeRank(label: string): number {
  const n = Number(label.replace(",", "."));
  if (Number.isFinite(n)) return n; // numeric sizes sort by value
  const i = LETTER_SIZES.indexOf(label.toUpperCase());
  return i >= 0 ? -100 + i : 500; // letter sizes in canonical order, first
}

/** Per-size stock from Variants[]: sum the Stocks[].Quantity per size, sorted. */
function pickSizes(p: any): SizeVariant[] {
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of p?.Variants ?? []) {
    const label = String(v?.Size?.AttributeValueText ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const qty = (v?.Stocks ?? []).reduce((s: number, x: any) => s + (Number(x?.Quantity) || 0), 0);
    sizes.push({ label, availability: qty <= 0 ? "out_of_stock" : qty <= 2 ? "low_on_stock" : "in_stock" });
  }
  return sizes.sort((a, b) => sizeRank(a.label) - sizeRank(b.label));
}

/**
 * Every EAN on the product, product-level plus one per size. The listing API
 * already returns these, so this costs no extra requests — and the per-size
 * ones matter because a shopper scans the tag of the size in their hand, which
 * is never the product-level code.
 */
function collectBarcodes(p: any): string[] | null {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const s = String(v ?? "").replace(/\D/g, "");
    if (s.length >= 8 && s.length <= 14) out.add(s);
  };
  add(p?.Barcode);
  for (const v of p?.Variants ?? []) {
    add(v?.Barcode);
    for (const st of v?.Stocks ?? []) add(st?.Barcode);
  }
  return out.size > 0 ? [...out] : null;
}

function mapProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = p?.ID != null ? String(p.ID) : "";
  const camp = Number(p?.CampaignPrice);
  const actual = Number(p?.ActualPriceToShowOnScreen);
  const strike = Number(p?.StrikeThroughPriceToShowOnScreen);
  // Two discount shapes: in-basket campaigns put the deal in CampaignPrice with
  // the shelf price (ActualPrice) as the "old" price; direct markdowns cross out
  // StrikeThrough. Handle both so we don't miss the campaign majority.
  const price = camp > 0 ? camp : actual;
  const oldPrice = camp > 0 ? actual : strike;
  if (!id || !Number.isFinite(price) || price <= 0) return null;
  const uri: string | undefined = p?.FriendlyURI;
  const sizes = pickSizes(p);
  // Colours are separate products; ColorVariants lists the whole set (incl.
  // self). Group on the smallest id so they collapse to one card + swatches.
  const colorIds = (p?.ColorVariants ?? [])
    .map((c: any) => Number(c?.ProductId))
    .filter((n: number) => n > 0);
  const groupKey = colorIds.length > 1 ? "boyner:" + Math.min(Number(id), ...colorIds) : null;
  return {
    brand: "boyner",
    externalId: id,
    barcodes: collectBarcodes(p),
    name: p?.DisplayName ?? "",
    url: uri ? `${SITE}/${uri}` : SITE,
    imageUrl: p?.FirstProductImageUrl ?? null,
    price: toMinor(price),
    listPrice: Number.isFinite(oldPrice) && oldPrice > price ? toMinor(oldPrice) : null,
    currency: "TRY",
    inStock: p?.HasStock !== false,
    category: p?.BrandName ?? null,
    gender,
    variants: sizes.length > 0 ? { colors: [], sizes } : null,
    groupKey,
    colorName: p?.ColorName ?? p?.Color ?? null,
  };
}

export const brand = "boyner";

/**
 * `OrderOption=Sale` is not monotonic in DiscountRate: zero-discount pages are
 * interleaved all through the ordering, deterministically. The old loop stopped
 * at the first page with no discount on it, which for CategoryID 1 is page 31 of
 * 2776 — and discounts run the entire depth (page 821 is still 23/24 reduced).
 * That single `break` was the real limiter; raising MAX_PAGES 60x changed
 * nothing while it was there.
 *
 * Page count is fixed at 24 per request (no page-size override exists) and there
 * is no discounted-only filter, so full coverage means ~3600 requests. That
 * needs a wide pool to fit the 240s budget. Measured on one connection: 24
 * workers 224s (too close to the ceiling to risk), 32 workers 190s, 48 workers
 * 115s — all returning the same product count, so nothing is being throttled
 * away at the wider settings.
 */
const PAGE_CONCURRENCY = Number(process.env.BOYNER_CONCURRENCY ?? 48);

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();

  const fetchPage = async (cat: number, page: number): Promise<any> =>
    getJson<any>(`${API}?CategoryID=${cat}&Page=${page}&OrderOption=Sale`, {
      headers: HEADERS,
    }).catch(() => null);

  const absorb = (data: any, gender: ProductRecord["gender"]) => {
    for (const p of data?.Result?.ProductList ?? []) {
      if (Number(p?.DiscountRate) > 0) {
        const rec = mapProduct(p, gender);
        if (rec && rec.listPrice) byId.set(rec.externalId, rec);
      }
    }
  };

  for (const cat of CATEGORIES) {
    const gender = CATEGORY_GENDER[cat] ?? null;
    // Page 1 reports TotalPageCount, which is what bounds the crawl.
    const first = await fetchPage(cat, 1);
    if (!first) continue;
    absorb(first, gender);
    const pages = Math.min(Number(first?.Result?.TotalPageCount ?? 1), MAX_PAGES);

    let next = 2;
    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, Math.max(0, pages - 1)) }, async () => {
        while (next <= pages) absorb(await fetchPage(cat, next++), gender);
      }),
    );
  }
  return [...byId.values()];
}
