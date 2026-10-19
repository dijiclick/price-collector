import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

/**
 * Modanisa (modanisa.com) — a modest-fashion marketplace; the label of each
 * product is a third-party brand. Routes, measured 2026-10-10:
 *
 * - LISTING: the search/listing BFF the site's Nuxt fragment calls,
 *   `searchlisting-web-bff.modanisa.com/products`. It wants the storefront
 *   headers below (400/500 without them) and caps `perPage` at 64. It reports
 *   prices only as DISPLAY strings: `campaignPriceValue` / `secondaryPrice` is
 *   the shelf price, and a `primaryPrice` with display "striped" is the
 *   struck-through original.
 * - FULL CATALOGUE (2026-10-19): with no `slug` the BFF lists the whole Turkish
 *   catalogue (totalCount ~72.6k, ~1,136 pages of 64), and the walk keeps every
 *   row — struck-through ones as deals, the rest with `listPrice: null`. The
 *   old walk read only the Outlet list and kept only struck-through rows, which
 *   had fallen to ~1 in 64 (16 rows on 10-19): Modanisa's outlet is "cheap", not
 *   "marked down", and its reductions are basket campaigns, which are not
 *   markdowns of the product.
 * - SIZES: `/api/product_variants.php`, the tiny HTML fragment the product page
 *   loads its size boxes from; an out-of-stock size carries `disabled`.
 *
 * Basket campaigns ("%15 İNDİRİMLİ …", "2000 TL ve Üzeri %20 İndirim") are not
 * markdowns of the product and are ignored, like Boyner's coupons.
 */
const SITE = "https://www.modanisa.com";
const BFF = "https://searchlisting-web-bff.modanisa.com/products";
const PER_PAGE = 64;
/** The walk THROWS past this (a capped walk would sell out the rest); ~1,136 today. */
const MAX_PAGES = Number(process.env.MODANISA_MAX_PAGES ?? 2500);
const CONCURRENCY = Number(process.env.MODANISA_CONCURRENCY ?? 6);
const DETAIL_LIMIT = Number(process.env.MODANISA_DETAIL_LIMIT ?? 700);
/** Wall clock for the whole adapter; the sizes pass stops when it runs out. */
const BUDGET_MS = Number(process.env.MODANISA_BUDGET_MS ?? 200_000);

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
  const started = Date.now();
  const byId = new Map<string, ProductRecord>();
  const seen = new Set<string>();
  // Direct only: ~80 MB a run is not something to send through the metered
  // residential proxy, and Turkey never uses it.
  const fetchPage = (page: number) =>
    getJson<any>(`${BFF}?page=${page}&perPage=${PER_PAGE}`, { headers: BFF_HEADERS }).catch(() => null);
  const absorb = (data: any) => {
    for (const it of data?.items ?? []) {
      if (it?.id != null) seen.add(String(it.id));
      const r = mapItem(it);
      if (r) byId.set(r.externalId, r);
    }
  };

  const first = await fetchPage(1);
  const total = Number(first?.metadata?.totalCount ?? 0);
  if (!first?.items || !(total > 0)) throw new Error("modanisa: listing page 1 failed — partial catalogue refused");
  absorb(first);
  const pages = Math.ceil(total / PER_PAGE);
  if (pages > MAX_PAGES) throw new Error(`modanisa: catalogue has ${pages} pages, over the cap of ${MAX_PAGES}`);

  const failed: number[] = [];
  const walk = (queue: number[], workers: number) =>
    pool(queue, workers, async (n) => {
      const d = await fetchPage(n);
      if (d?.items) absorb(d);
      else failed.push(n);
    });
  await walk(Array.from({ length: pages - 1 }, (_, i) => i + 2), CONCURRENCY);
  await walk(failed.splice(0), 2); // one more try each, then refuse
  if (failed.length) throw new Error(`modanisa: ${failed.length} listing pages failed — partial catalogue refused`);
  // Paging a live listing shifts rows between pages mid-walk; more than 1%
  // short of the shop's own count would sell out real stock.
  if (seen.size < total * 0.99) throw new Error(`modanisa: walk saw ${seen.size} of ${total} products — partial catalogue refused`);

  // Sizes: deals first, then a random slice of full price; the upsert keeps
  // what earlier runs found, so coverage rotates.
  const records = [...byId.values()];
  const shuffle = <T>(a: T[]) => {
    for (let j = a.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [a[j], a[k]] = [a[k], a[j]];
    }
    return a;
  };
  const queue = [...shuffle(records.filter((r) => r.listPrice != null)), ...shuffle(records.filter((r) => r.listPrice == null))];
  await pool(queue.slice(0, DETAIL_LIMIT), 3, async (r) => {
    if (Date.now() - started > BUDGET_MS) return;
    const slug = r.url.slice(SITE.length + 1).replace(/\.html$/, "");
    const html = await getText(variantsUrl(r.externalId, slug), { headers: { "X-Requested-With": "XMLHttpRequest" }, timeoutMs: 20_000 }).catch(() => "");
    const sizes = parseVariantHtml(html);
    if (sizes.length === 0) return;
    r.variants = { colors: r.variants?.colors ?? [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}
