import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { categoryPath, toMinor } from "../normalize";

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
 *   "marked down", and most of its reductions are campaigns (below).
 * - SIZES: `/api/product_variants.php`, the tiny HTML fragment the product page
 *   loads its size boxes from; an out-of-stock size carries `disabled`.
 *
 * Campaigns (`metadata.campaign`, 2026-10-21): "%15 İNDİRİMLİ  212,49 TL" is
 * an automatic per-product price — a guest basket holding just that one item
 * (8882739: 249,99 → 212,49; 9437034: 1.089,99 → 926,49) is charged it, with
 * no code and no minimum — so it is the price and the shelf (or struck-through)
 * price is the original, the same rule as LCW/DeFacto/Boyner's basket prices.
 * "2000 TL ve Üzeri %20 İndirim" (a basket minimum) and "3 Al 2 Öde" (a
 * multi-buy) are not prices of the product and are ignored.
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

/**
 * The automatic campaign price out of "%15 İNDİRİMLİ  212,49 TL", or NaN for
 * anything conditional (a basket minimum, a coupon/code, a multi-buy) or a
 * price that does not match its own percentage off `shelf`.
 */
export function campaignPrice(campaign: any, shelf: number): number {
  if (!campaign || campaign.display === "hidden") return NaN;
  const text = String(campaign.smallText || campaign.label || "").replace(/\s+/g, " ").trim();
  if (/sepet|kupon|kod|[üu]zeri|\bal\b.*[öo]de/i.test(text)) return NaN;
  const m = text.match(/^%(\d{1,2}) (?:İNDİRİMLİ|İndirimli) (\d[\d.]*(?:,\d+)?) TL$/);
  if (!m) return NaN;
  const price = trMoney(m[2]);
  return Math.abs(shelf * (1 - Number(m[1]) / 100) - price) <= shelf * 0.01 ? price : NaN;
}

/** Price and original from the BFF's display metadata. */
export function pricesOf(meta: any): { price: number; list: number | null } | null {
  const shelf = trMoney(meta?.campaignPriceValue) || trMoney(meta?.secondaryPrice?.display !== "hidden" ? meta?.secondaryPrice?.label : "");
  if (!Number.isFinite(shelf) || shelf <= 0) return null;
  const struck = meta?.primaryPrice?.display === "striped" ? trMoney(meta.primaryPrice.label) : NaN;
  const original = Number.isFinite(struck) && struck > shelf ? struck : null;
  const campaign = campaignPrice(meta?.campaign, shelf);
  if (campaign > 0 && campaign < shelf) return { price: campaign, list: original ?? shelf };
  return { price: shelf, list: original };
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
    // The shop's categories ("Elbiseler", "Tesettür Giyim", "Takım"), an unordered
    // set the classifier reads segment by segment; the marketplace label is `maker`.
    category: categoryPath(cats),
    maker: it.brand ? String(it.brand).trim() || null : null,
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

/**
 * Pages worth asking again: every page between the first and last page an id
 * turned up on, plus one either side.
 *
 * The BFF's default order is not stable past roughly page 380: products that
 * tie on its sort key come back in a different order from one request to the
 * next (the same page fetched six times gave two different id sets, and
 * repeated walks report totalCount 72843/72845/72840 — several backends).
 * A product that hops a page boundary between two requests is seen twice and
 * its neighbour never: on 2026-10-20 one walk returned every page full
 * (72,843 rows) but only 72,064 distinct ids, 779 duplicated, every one of
 * them on adjacent pages (1-4 apart), none on the same page and none before
 * page 389. The products it skipped sit on those same pages, so asking them
 * again draws a different order and fills the hole.
 */
export function suspectPages(pagesOf: Map<string, Set<number>>, lastPage: number): number[] {
  const out = new Set<number>();
  for (const ps of pagesOf.values()) {
    if (ps.size < 2) continue;
    const min = Math.min(...ps);
    const max = Math.max(...ps);
    // A shuffle moves a product a few pages at most; an id seen far apart
    // gets only its own pages' neighbours, so one stray never re-walks the catalogue.
    const spans = max - min <= MAX_SHUFFLE_SPAN ? [[min, max]] : [...ps].map((p) => [p, p]);
    for (const [a, b] of spans) {
      for (let p = Math.max(1, a - 1); p <= Math.min(lastPage, b + 1); p++) out.add(p);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Widest page gap the tail shuffle was seen to move a product (4 on 10-20), with margin. */
const MAX_SHUFFLE_SPAN = 8;

/** Re-ask the suspect pages at most this many times; one round recovered 700 of 779 on 10-20. */
const MEND_ROUNDS = 2;

/** The listing walk, with the page fetch injectable for tests. */
export async function walkListing(fetchPage: (page: number) => Promise<any>, concurrency = CONCURRENCY) {
  const byId = new Map<string, ProductRecord>();
  const pagesOf = new Map<string, Set<number>>();
  const absorb = (page: number, data: any) => {
    for (const it of data?.items ?? []) {
      if (it?.id != null) {
        const id = String(it.id);
        pagesOf.set(id, (pagesOf.get(id) ?? new Set()).add(page));
      }
      const r = mapItem(it);
      if (r) byId.set(r.externalId, r);
    }
  };

  const first = await fetchPage(1);
  const total = Number(first?.metadata?.totalCount ?? 0);
  if (!first?.items || !(total > 0)) throw new Error("modanisa: listing page 1 failed — partial catalogue refused");
  absorb(1, first);
  const pages = Math.ceil(total / PER_PAGE);
  if (pages > MAX_PAGES) throw new Error(`modanisa: catalogue has ${pages} pages, over the cap of ${MAX_PAGES}`);

  const failed: number[] = [];
  const walk = (queue: number[], workers: number) =>
    pool(queue, workers, async (n) => {
      const d = await fetchPage(n);
      if (d?.items) absorb(n, d);
      else failed.push(n);
    });
  await walk(Array.from({ length: pages - 1 }, (_, i) => i + 2), concurrency);
  await walk(failed.splice(0), 2); // one more try each, then refuse
  if (failed.length) throw new Error(`modanisa: ${failed.length} listing pages failed — partial catalogue refused`);

  // Mend the unstable tail: ask the pages that shuffled again. A page that
  // fails here costs nothing — the walk already has a copy of it.
  const walked = pagesOf.size;
  for (let round = 0; round < MEND_ROUNDS && pagesOf.size < total; round++) {
    const before = pagesOf.size;
    await walk(suspectPages(pagesOf, pages), concurrency);
    failed.length = 0;
    if (pagesOf.size === before) break;
  }
  if (pagesOf.size > walked) console.log(`modanisa: walk saw ${walked} of ${total}, re-asking shuffled pages brought it to ${pagesOf.size}`);
  // Still more than 1% short of the shop's own count: something other than
  // the shuffle is wrong, and returning it would sell out real stock.
  if (pagesOf.size < total * 0.99) throw new Error(`modanisa: walk saw ${pagesOf.size} of ${total} products — partial catalogue refused`);
  return { byId, seen: pagesOf.size, total };
}

export async function listProducts(): Promise<ProductRecord[]> {
  const started = Date.now();
  // Direct only: ~80 MB a run (plus about half again when the tail shuffles)
  // is not something to send through the metered residential proxy, and
  // Turkey never uses it.
  const fetchPage = (page: number) =>
    getJson<any>(`${BFF}?page=${page}&perPage=${PER_PAGE}`, { headers: BFF_HEADERS }).catch(() => null);
  const { byId } = await walkListing(fetchPage);

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
