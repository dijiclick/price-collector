import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

/**
 * Modanisa (modanisa.com) — a modest-fashion marketplace; the label of each
 * product is a third-party brand. Routes, measured 2026-10-10:
 *
 * - LISTING: the search/listing BFF the site's Nuxt fragment calls,
 *   `searchlisting-web-bff.modanisa.com/products?slug=<list slug>`. It wants the
 *   storefront headers below (400 without them) and caps `perPage` at 64. It
 *   reports prices only as DISPLAY strings: `campaignPriceValue` /
 *   `secondaryPrice` is the shelf price, and a `primaryPrice` with display
 *   "striped" is the struck-through original. There is no discount filter or
 *   sort, and most of even the Outlet list (~9.8k items) has no strikethrough —
 *   Modanisa's outlet is "cheap", not "marked down" — so the walk keeps only the
 *   struck-through rows (~6%).
 * - SIZES: `/api/product_variants.php`, the tiny HTML fragment the product page
 *   loads its size boxes from; an out-of-stock size carries `disabled`.
 *
 * Basket campaigns ("%15 İNDİRİMLİ …", "2000 TL ve Üzeri %20 İndirim") are not
 * markdowns of the product and are ignored, like Boyner's coupons.
 */
const SITE = "https://www.modanisa.com";
const BFF = "https://searchlisting-web-bff.modanisa.com/products";
const SLUGS = (process.env.MODANISA_LISTS ?? "outlet-12.list").split(",").map((s) => s.trim()).filter(Boolean);
const PER_PAGE = 64;
const MAX_PAGES = Number(process.env.MODANISA_MAX_PAGES ?? 160); // per list
const MAX_PRODUCTS = Number(process.env.MODANISA_MAX_PRODUCTS ?? 2000);
const DETAIL_LIMIT = Number(process.env.MODANISA_DETAIL_LIMIT ?? 700);

export const BFF_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Language": "tr",
  "X-Shipping-Country-Code": "TR",
  "X-DisplayCurrency": "TRY",
  "X-Platform": "desktopWeb",
  "X-Multi-Warehouse-Enabled": "false",
};

/** "1.299,99 TL" → 1299.99 (NaN when there is no number). */
export function trMoney(s: unknown): number {
  const m = String(s ?? "").match(/\d[\d.]*(?:,\d+)?/);
  if (!m) return NaN;
  return Number(m[0].replace(/\./g, "").replace(",", "."));
}

/** Shelf price and struck-through original from the BFF's display metadata. */
export function pricesOf(meta: any): { price: number; list: number | null } | null {
  const shelf = trMoney(meta?.campaignPriceValue) || trMoney(meta?.secondaryPrice?.display !== "hidden" ? meta?.secondaryPrice?.label : "");
  if (!Number.isFinite(shelf) || shelf <= 0) return null;
  const struck = meta?.primaryPrice?.display === "striped" ? trMoney(meta.primaryPrice.label) : NaN;
  return { price: shelf, list: Number.isFinite(struck) && struck > shelf ? struck : null };
}

function genderOf(categories: string[]): ProductRecord["gender"] {
  const c = categories.join(" | ");
  if (/[çc]ocuk|bebek|gen[çc] k[ıi]z|k[ıi]z [çc]ocuk/i.test(c)) return "cocuk";
  if (/\berkek\b/i.test(c)) return "erkek";
  return "kadin"; // a women's modest-fashion shop
}

export function mapItem(it: any): ProductRecord | null {
  const money = pricesOf(it?.metadata);
  if (!it?.id || !it?.slug || !it?.name || !money) return null;
  const imgs: string[] = (it.images ?? []).filter((u: unknown) => typeof u === "string");
  const cats: string[] = (it.categories ?? []).map(String);
  const colour = Array.isArray(it.colors) && it.colors[0] ? String(it.colors[0]) : null;
  // The listing's `sizes` are the sizes on sale right now; the detail pass
  // replaces them with the full list, sold-out sizes included.
  const sizes: SizeVariant[] = (it.sizes ?? []).map((s: unknown) => ({ label: String(s), availability: "in_stock" as const }));
  return {
    brand: "modanisa",
    externalId: String(it.id),
    name: String(it.name).replace(/\s+/g, " ").trim(),
    url: `${SITE}/${it.slug}.html`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(money.price),
    listPrice: money.list != null ? toMinor(money.list) : null,
    currency: "TRY",
    inStock: true,
    // Marketplace: the label goes in category, as for Boyner and Beymen.
    category: it.brand ? String(it.brand) : null,
    gender: genderOf(cats),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    colorName: colour,
  };
}

/** Sizes out of `/api/product_variants.php`'s `<option>` list. */
export function parseVariantHtml(html: string): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)) {
    const attrs = m[1];
    if (!/\bdata-id="\d+"/.test(attrs)) continue; // the "Beden Seçiniz" placeholder
    const label = m[2].replace(/\s+/g, " ").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: /\bdisabled\b/.test(attrs) ? "out_of_stock" : "in_stock" });
  }
  return out;
}

export function variantsUrl(id: string, slug: string): string {
  return `${SITE}/api/product_variants.php?productId=${encodeURIComponent(id)}&productSef=${encodeURIComponent(slug)}&beden=`;
}

/** Run `fn` over `items` with bounded concurrency. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export const brand = "modanisa";

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  outer: for (const slug of SLUGS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BFF}?slug=${encodeURIComponent(slug)}&page=${page}&perPage=${PER_PAGE}`;
      const data = await getJson<any>(url, { headers: BFF_HEADERS, proxy: true }).catch(() => null);
      const items: any[] = data?.items ?? [];
      for (const it of items) {
        const r = mapItem(it);
        if (r && r.listPrice != null) byId.set(r.externalId, r);
        if (byId.size >= MAX_PRODUCTS) break outer;
      }
      if (items.length < PER_PAGE || !data?.metadata?.links?.next) break;
    }
  }

  const records = [...byId.values()];
  await pool(records.slice(0, DETAIL_LIMIT), 3, async (r) => {
    const slug = r.url.slice(SITE.length + 1).replace(/\.html$/, "");
    const html = await getText(variantsUrl(r.externalId, slug), { headers: { "X-Requested-With": "XMLHttpRequest" } }).catch(() => "");
    const sizes = parseVariantHtml(html);
    if (sizes.length === 0) return;
    r.variants = { colors: r.variants?.colors ?? [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}
