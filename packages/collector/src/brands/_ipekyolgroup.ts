/**
 * Shared collector for the İpekyol Group storefronts (İpekyol, Twist): one
 * Next.js (pages router) front end over the group's own commerce API.
 *
 * The page data is served at `/_next/data/<buildId>/<path>.json`, so a
 * listing page is JSON: `pageProps.data.response` holds `products[]`
 * (price, strike price, per-barcode stock), `totalPages`, and `?page=N` pages
 * it. The buildId changes with every deploy, so it is read from the home
 * page's `__NEXT_DATA__` at the start of each run.
 *
 * The sale is the `outlet` category on both (İpekyol 1,113 rows, Twist 474,
 * 2026-10-10). Listing rows carry stock per barcode id but not which size a
 * barcode is; the PDP (`/_next/data/<id>/urun/<routePath>.json`) names them
 * (`barcodes[].stockTypeValues[0].name`), so sizes come from a bounded PDP pass.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

export interface GroupShop {
  brand: string;
  /** Origin, e.g. `https://www.twist.com.tr`. */
  site: string;
  /** Image CDN prefix the document `filePath` is appended to. */
  imageBase: string;
  /** Sale listing path, e.g. `outlet`. */
  salePath: string;
  /**
   * Listing paths that together hold the WHOLE catalogue (listGroupCatalogue),
   * e.g. İpekyol's `koleksiyon` (new season) + `outlet`.
   */
  cataloguePaths?: string[];
}

export interface GroupLimits {
  maxProducts: number;
  maxPages: number;
  detailLimit: number;
}

const CONCURRENCY = 3;

export function buildIdFromHtml(html: string): string | null {
  return html.match(/"buildId"\s*:\s*"([^"]+)"/)?.[1] ?? null;
}

const LETTER: Record<string, number> = { XXS: 1, XS: 2, S: 3, M: 4, L: 5, XL: 6, XXL: 7, "2XL": 7, XXXL: 8, "3XL": 8 };
/** Shelf order for a size label when the shop gives none: numbers ascending, then XS…3XL, then the rest. */
const sizeRank = (label: string) => {
  const t = label.trim().toUpperCase();
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  return t in LETTER ? 1000 + LETTER[t] : 2000;
};

/**
 * Per-size stock from `barcodes[]` + `stocksByBarcode`. The PDP's size values
 * carry an `order`; İpekyol's LISTING rows already name the sizes but without
 * one (and out of shelf order: 44, 34, 42…), so those are ranked by label.
 */
export function groupSizes(p: any): SizeVariant[] {
  const stock: Record<string, number> = p?.stocksByBarcode ?? {};
  const rank = (v: any) => (typeof v?.order === "number" ? v.order : sizeRank(String(v?.name ?? "")));
  const rows = (p?.barcodes ?? [])
    .map((b: any) => ({ id: b?.id, v: b?.stockTypeValues?.[0] }))
    .filter((x: any) => x.v?.name)
    .sort((a: any, b: any) => rank(a.v) - rank(b.v));
  const seen = new Set<string>();
  const out: SizeVariant[] = [];
  for (const { id, v } of rows) {
    const label = String(v.name).trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: Number(stock[String(id)] ?? 0) > 0 ? "in_stock" : "out_of_stock" });
  }
  return out;
}

/** Map one listing (or PDP) product. Pure. */
export function mapGroupProduct(shop: GroupShop, p: any): ProductRecord | null {
  const base = Number(p?.basePrice);
  const sale = [p?.salesPrice, p?.discountPrice].map(Number).filter((x) => Number.isFinite(x) && x > 0);
  const price = sale.length ? Math.min(...sale) : base;
  if (!p?.id || !p?.name || !p?.routePath || !Number.isFinite(price) || price <= 0) return null;
  const docs = [...(p.documents ?? [])]
    .filter((d: any) => d?.documentType === "Image" && typeof d.filePath === "string")
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const imgs = docs.map((d: any) => `${shop.imageBase}${d.filePath.startsWith("/") ? "" : "/"}${d.filePath}`);
  const stock = Object.values(p.stocksByBarcode ?? {}).map(Number);
  const colour =
    (p.attributes ?? []).find((a: any) => a?.attribute?.integrationCode === "color")?.attributeValues?.[0]?.value ??
    (typeof p.shortName === "string" && p.shortName.trim() ? p.shortName.trim() : null);
  const category =
    (p.categories ?? []).find((c: any) => c?.name && !/outlet/i.test(c.name))?.name ?? p.categories?.[0]?.name ?? null;
  const siblings: number[] = (p.variations ?? []).map(Number).filter(Number.isFinite);
  const sizes = Array.isArray(p.barcodes) && p.barcodes.some((b: any) => b?.stockTypeValues) ? groupSizes(p) : [];
  return {
    brand: shop.brand,
    country: "TR",
    externalId: String(p.id),
    name: String(p.name).trim(),
    url: `${shop.site}/urun/${p.routePath}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(base) && base > price ? toMinor(base) : null,
    currency: "TRY",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : stock.length ? stock.some((n) => n > 0) : true,
    category,
    // Both are women's labels; neither sells a men's or kids' line.
    gender: "kadin",
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    // `variations` lists the product ids of every colour of this model,
    // itself included — an explicit grouping from the shop.
    groupKey: siblings.length > 1 ? String(Math.min(...siblings)) : null,
    colorName: colour,
  };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function listGroup(shop: GroupShop, limits: GroupLimits): Promise<ProductRecord[]> {
  const buildId = buildIdFromHtml(await getText(`${shop.site}/`));
  if (!buildId) throw new Error(`${shop.brand}: no Next.js buildId on the home page`);
  const data = (path: string) => `${shop.site}/_next/data/${buildId}/${path}.json`;
  const listing = (n: number) => `${data(shop.salePath)}${n > 1 ? `?page=${n}` : ""}`;

  const byId = new Map<string, ProductRecord>();
  const take = (body: any) => {
    for (const p of body?.pageProps?.data?.response?.products ?? []) {
      const r = mapGroupProduct(shop, p);
      if (r && r.listPrice != null && byId.size < limits.maxProducts) byId.set(r.externalId, r);
    }
  };
  const first = await getJson<any>(listing(1));
  take(first);
  const total = Math.min(Number(first?.pageProps?.data?.response?.totalPages ?? 1), limits.maxPages);
  const pages = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2);
  await pool(pages, CONCURRENCY, async (n) => {
    if (byId.size >= limits.maxProducts) return;
    take(await getJson<any>(listing(n)).catch(() => null));
  });

  const records = [...byId.values()];
  const todo = records.filter((r) => !r.variants);
  for (let j = todo.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [todo[j], todo[k]] = [todo[k], todo[j]];
  }
  await pool(todo.slice(0, limits.detailLimit), CONCURRENCY, async (r) => {
    const route = r.url.slice(`${shop.site}/urun/`.length);
    const body = await getJson<any>(data(`urun/${route}`), { retries: 1 }).catch(() => null);
    const p = body?.pageProps?.data?.response?.product;
    if (!p) return;
    const sizes = groupSizes(p);
    if (!sizes.length) return;
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  return records;
}

/**
 * FULL CATALOGUE (2026-10-19): every listing in `shop.cataloguePaths` is paged
 * to its end (20 rows a page — the `_next/data` route takes no page size) and
 * EVERY row is kept: reduced rows with their strike price exactly as the sale
 * walk read them, the rest as full-price rows (`listPrice` null). Then the
 * same bounded PDP pass fills sizes for rows whose listing lacked them,
 * reduced rows first.
 *
 * The collector delists whatever a run does not return, so a refused page,
 * a page budget overrun, a cap, or a listing that comes back short of its own
 * `totalItems` (1% allowed for stock moving mid-walk) fails the run instead.
 */
export async function listGroupCatalogue(
  shop: GroupShop,
  limits: GroupLimits & { pauseMs?: number },
): Promise<ProductRecord[]> {
  const paths = shop.cataloguePaths ?? [];
  if (!paths.length) throw new Error(`${shop.brand}: no catalogue paths`);
  const buildId = buildIdFromHtml(await getText(`${shop.site}/`));
  if (!buildId) throw new Error(`${shop.brand}: no Next.js buildId on the home page`);
  const data = (path: string) => `${shop.site}/_next/data/${buildId}/${path}.json`;
  const pause = limits.pauseMs ?? 150;
  let pages = 0;
  const page = async (path: string, n: number) => {
    if (pages >= limits.maxPages) throw new Error(`${shop.brand}: over ${limits.maxPages} listing pages — raise MAX_PAGES`);
    pages++;
    await new Promise((r) => setTimeout(r, pause));
    const body = await getJson<any>(`${data(path)}${n > 1 ? `?page=${n}` : ""}`, { retries: 2 }).catch(() => null);
    const res = body?.pageProps?.data?.response;
    if (!res || !Array.isArray(res.products)) throw new Error(`${shop.brand}: ${path} page ${n} refused — partial walk refused`);
    return res;
  };

  const byId = new Map<string, ProductRecord>();
  for (const path of paths) {
    const seen = new Set<string>();
    const take = (res: any) => {
      for (const p of res.products) {
        if (p?.id != null) seen.add(String(p.id));
        const r = mapGroupProduct(shop, p);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    };
    const first = await page(path, 1);
    take(first);
    const total = Number(first.totalItems) || 0;
    const count = Number(first.totalPages) || 1;
    await pool(Array.from({ length: Math.max(0, count - 1) }, (_, i) => i + 2), CONCURRENCY, async (n) => take(await page(path, n)));
    if (seen.size < total * 0.99) throw new Error(`${shop.brand}: ${path} gave ${seen.size} of ${total} rows — partial walk refused`);
  }
  if (byId.size > limits.maxProducts) throw new Error(`${shop.brand}: ${byId.size} products, over the cap of ${limits.maxProducts}`);

  const records = [...byId.values()];
  const shuffle = <T>(a: T[]) => {
    for (let j = a.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [a[j], a[k]] = [a[k], a[j]];
    }
    return a;
  };
  const todo = [
    ...shuffle(records.filter((r) => !r.variants && r.listPrice != null)),
    ...shuffle(records.filter((r) => !r.variants && r.listPrice == null)),
  ];
  await pool(todo.slice(0, limits.detailLimit), CONCURRENCY, async (r) => {
    const route = r.url.slice(`${shop.site}/urun/`.length);
    const body = await getJson<any>(data(`urun/${route}`), { retries: 1 }).catch(() => null);
    const p = body?.pageProps?.data?.response?.product;
    if (!p) return;
    const sizes = groupSizes(p);
    if (!sizes.length) return;
    r.variants = { colors: r.colorName ? [r.colorName] : [], sizes };
    r.inStock = sizes.some((s) => s.availability !== "out_of_stock");
  });
  if (process.env.GROUP_DEBUG) console.error(`${shop.brand}: ${pages} pages, ${records.length} rows, ${todo.length} without sizes`);
  return [...records.filter((r) => r.listPrice != null), ...records.filter((r) => r.listPrice == null)];
}

export function groupLimitsFromEnv(prefix: string, d: GroupLimits): GroupLimits {
  const n = (k: string, v: number) => {
    const x = Number(process.env[`${prefix}_${k}`]);
    return Number.isFinite(x) && x > 0 ? x : v;
  };
  return { maxProducts: n("MAX_PRODUCTS", d.maxProducts), maxPages: n("MAX_PAGES", d.maxPages), detailLimit: n("DETAIL_LIMIT", d.detailLimit) };
}
