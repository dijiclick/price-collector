/**
 * Shared collector for Akinon storefronts (Lacoste TR, Pierre Cardin TR,
 * Marks & Spencer TR — the same platform as Koton).
 *
 * Akinon answers JSON for any listing or product path with `?format=json`:
 *   - `/list/?format=json&page_size=100&page=N` is the whole catalogue,
 *   - a category path (`/tum-indirim/`) is that category,
 *   - a product path is its PDP with `variants[]` (one group per attribute,
 *     each option carrying `in_stock` and the sibling SKU as `product`).
 * Listing rows often embed the same `variants[]` under `extra_data` (Pierre
 * Cardin, M&S), which gives per-size stock without a PDP call; where they do
 * not (Lacoste lists colours only), sizes come from a bounded PDP pass.
 *
 * IDENTITY. A listing row is ONE SKU (one size) standing in for its colour,
 * and the PDP's colour option points at whichever size the url named — so
 * neither `pk` is stable (verified 2026-10-10: Pierre Cardin's ekru polo lists
 * as pk 256176, the same colour fetched by its 2XL url says 256135). The
 * stable key is `base_code` + the colour attribute, which every SKU of a
 * colour shares and the resolver in lib/live-brands/_akinon.ts rebuilds from a
 * pasted url. `base_code` alone is shared across colours, so it is the groupKey.
 */
import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

export interface AkinonShop {
  brand: string;
  /** Origin, e.g. `https://www.lacoste.com.tr`. */
  site: string;
  /** Listing path to walk, e.g. `/list/` (whole catalogue) or `/tum-indirim/`. */
  listPath: string;
  /** Attribute key of the size group in `variants[]` (`integration_size`). */
  sizeKey: string;
  /** Attribute key of the colour group / colour attribute (`integration_color`). */
  colorKey: string;
  /**
   * Attribute on the size option's `product.attributes` holding the shopper-
   * facing size. Lacoste's option labels are codes (`T65`); the real size
   * (`40`) is `filterable_size`. Absent: the option label is used.
   */
  sizeLabelAttr?: string;
  /** Attributes tried, in order, for a human colour name. Falls back to the colour option label. */
  colorNameAttrs: string[];
  /** Attributes tried, in order, for the product type. `attributes_kwargs[a].label` wins over the raw value. */
  categoryAttrs: string[];
  /** Attributes tried, in order, for the section (Kadın / Erkek / Çocuk). */
  genderAttrs: string[];
}

/** Tunables, overridable per run for live tests. */
export interface AkinonLimits {
  /** Most products returned. */
  maxProducts: number;
  /** Most listing pages fetched (100 products each). */
  maxPages: number;
  /** Most PDP calls for sizes, when the listing does not embed them. */
  detailLimit: number;
}

const PAGE_SIZE = 100;
const CONCURRENCY = 3;

const fold = (s: string) =>
  s
    .replace(/[İI]/g, "i")
    .replace(/ı/g, "i")
    .replace(/[Çç]/g, "c")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Öö]/g, "o")
    .replace(/[Üü]/g, "u")
    .toLowerCase();

/** "Kadın" / "erkek_cocuk" / "Unisex" → our section, or null. Child first: "Erkek Çocuk" is a child. */
export function genderOf(text: string | null | undefined): ProductRecord["gender"] {
  if (!text) return null;
  const t = fold(text);
  if (/cocuk|bebek|kiz|genc/.test(t)) return "cocuk";
  if (/kadin/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return null;
}

/** An attribute's display label (`attributes_kwargs[a].label`), else its raw value. */
function attr(p: any, key: string): string | null {
  const kw = p?.attributes_kwargs?.[key];
  const v = (kw && typeof kw === "object" && kw.label) || p?.attributes?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The stable per-colour id: `<base_code>-<colour>`, `<base_code>` when colourless, `pk` as a last resort. */
export function akinonId(p: any, colorKey: string): string | null {
  const base = typeof p?.base_code === "string" ? p.base_code.trim() : "";
  const colour = p?.attributes?.[colorKey];
  if (base) return typeof colour === "string" && colour.trim() ? `${base}-${colour.trim()}` : base;
  return p?.pk != null ? String(p.pk) : null;
}

/** Sizes from an Akinon `variants[]` list (PDP body or a listing row's `extra_data`). */
export function akinonSizes(groups: any[] | null | undefined, shop: Pick<AkinonShop, "sizeKey" | "sizeLabelAttr">): SizeVariant[] {
  const opts: any[] = (groups ?? []).find((g) => g?.attribute_key === shop.sizeKey)?.options ?? [];
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const o of opts) {
    const fromAttr = shop.sizeLabelAttr ? o?.product?.attributes?.[shop.sizeLabelAttr] : null;
    const label = String((typeof fromAttr === "string" && fromAttr.trim()) || o?.label || "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: o?.in_stock ? "in_stock" : "out_of_stock" });
  }
  return sizes;
}

/** Colour names offered in a `variants[]` list. */
function akinonColors(groups: any[] | null | undefined, colorKey: string): string[] {
  const opts: any[] = (groups ?? []).find((g) => g?.attribute_key === colorKey)?.options ?? [];
  return [...new Set(opts.map((o) => String(o?.label ?? "").trim()).filter(Boolean))];
}

/** Map one listing row. Pure; `null` for rows without a usable price or id. */
export function mapAkinonProduct(shop: AkinonShop, p: any): ProductRecord | null {
  const id = akinonId(p, shop.colorKey);
  const price = parseFloat(p?.price);
  if (!id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const retail = parseFloat(p?.retail_price);

  const all = [...(p.productimage_set ?? [])].filter(Boolean).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const shots = all.filter((im: any) => im.status == null || im.status === "active");
  const first = (shots[0] ?? all[0])?.image ?? null;
  const gallery = cleanGallery(
    shots.map((im: any) => im.image).filter((u: unknown) => typeof u === "string" && !/\.(mp4|mov|webm)(\?|$)/i.test(u)),
    first,
  );

  const groups: any[] = p.extra_data?.variants ?? [];
  const sizes = akinonSizes(groups, shop);
  const colors = akinonColors(groups, shop.colorKey);
  const colorName = shop.colorNameAttrs.map((a) => attr(p, a)).find(Boolean) ?? colors[0] ?? null;
  const variants: ProductVariants | null = sizes.length ? { colors, sizes } : null;

  const hasColour = typeof p.attributes?.[shop.colorKey] === "string" && p.attributes[shop.colorKey].trim() !== "";
  const genderText = shop.genderAttrs.map((a) => attr(p, a)).find(Boolean) ?? null;

  return {
    brand: shop.brand,
    country: "TR",
    externalId: id,
    name: String(p.name).trim(),
    url: p.absolute_url ? `${shop.site}${p.absolute_url}` : shop.site,
    imageUrl: first,
    images: gallery,
    price: toMinor(price),
    listPrice: Number.isFinite(retail) && retail > price ? toMinor(retail) : null,
    currency: "TRY",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : p.in_stock === true,
    category: shop.categoryAttrs.map((a) => attr(p, a)).find(Boolean) ?? null,
    gender: genderOf(genderText) ?? genderOf(p.absolute_url),
    variants,
    groupKey: hasColour && p.base_code ? String(p.base_code) : null,
    colorName,
  };
}

/** Run `fn` over `items` with bounded concurrency. */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function fetchPdpVariants(shop: AkinonShop, url: string): Promise<ProductVariants | null> {
  const path = url.slice(shop.site.length).split("?")[0];
  const data = await getJson<any>(`${shop.site}${path}?format=json`, { retries: 1 }).catch(() => null);
  const groups: any[] = data?.variants ?? [];
  const sizes = akinonSizes(groups, shop);
  if (!sizes.length) return null;
  return { colors: akinonColors(groups, shop.colorKey), sizes };
}

/**
 * Below this many reduced rows a shop is between sales, not in one. Lacoste TR
 * 2026-10-16: the season sale ended and ONE watch of 2,018 rows kept a strike
 * price; returning only that row dropped the 1,880-row catalogue (and its size
 * tracking) every time a stray markdown appeared, and the run read as a 99%
 * crawler drop. Same floor as the health rule's `drop` baseline.
 */
export const MIN_SALE_ROWS = 50;

/**
 * Which rows a walk returns: the reduced ones during a sale; between sales
 * (fewer than MIN_SALE_ROWS reduced) the reduced rows first, topped up with
 * full-price rows, so the catalogue keeps being tracked. Capped at `max`.
 */
export function pickAkinonRecords(sale: ProductRecord[], full: ProductRecord[], max: number): ProductRecord[] {
  return (sale.length >= MIN_SALE_ROWS ? sale : [...sale, ...full]).slice(0, max);
}

/**
 * Walk `shop.listPath` and return its discounted products (price < retail).
 * Between sales (see pickAkinonRecords) the full-price rows are returned too
 * (capped), so a brand still has a catalogue to track sizes on — the same
 * fallback Koton uses for its detail pass.
 */
export async function listAkinon(shop: AkinonShop, limits: AkinonLimits): Promise<ProductRecord[]> {
  const pageUrl = (n: number) => {
    const sep = shop.listPath.includes("?") ? "&" : "?";
    return `${shop.site}${shop.listPath}${sep}format=json&page_size=${PAGE_SIZE}&page=${n}`;
  };
  const sale = new Map<string, ProductRecord>();
  const full = new Map<string, ProductRecord>();
  const take = (rows: any[]) => {
    for (const p of rows) {
      const r = mapAkinonProduct(shop, p);
      if (!r) continue;
      if (r.listPrice != null) sale.set(r.externalId, r);
      else if (full.size < limits.maxProducts) full.set(r.externalId, r);
    }
  };

  const first = await getJson<any>(pageUrl(1));
  take(first?.products ?? []);
  const numPages = Math.min(Number(first?.pagination?.num_pages ?? 1), limits.maxPages);
  const pages = Array.from({ length: Math.max(0, numPages - 1) }, (_, i) => i + 2);
  await pool(pages, CONCURRENCY, async (n) => {
    if (sale.size >= limits.maxProducts) return;
    const data = await getJson<any>(pageUrl(n)).catch(() => null);
    take(data?.products ?? []);
  });

  const records = pickAkinonRecords([...sale.values()], [...full.values()], limits.maxProducts);

  // Sizes the listing did not embed: one PDP each, a rotating shuffled subset
  // per run (the upsert keeps earlier variants, so coverage accumulates).
  const missing = records.filter((r) => !r.variants && r.url.startsWith(shop.site) && r.url !== shop.site);
  for (let j = missing.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [missing[j], missing[k]] = [missing[k], missing[j]];
  }
  await pool(missing.slice(0, limits.detailLimit), CONCURRENCY, async (r) => {
    const v = await fetchPdpVariants(shop, r.url);
    if (!v) return;
    r.variants = v;
    r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
  });

  return records;
}

/** Limits from env with a per-brand prefix (`LACOSTE_MAX_PAGES`, …). */
export function limitsFromEnv(prefix: string, d: AkinonLimits): AkinonLimits {
  const n = (k: string, v: number) => {
    const x = Number(process.env[`${prefix}_${k}`]);
    return Number.isFinite(x) && x > 0 ? x : v;
  };
  return {
    maxProducts: n("MAX_PRODUCTS", d.maxProducts),
    maxPages: n("MAX_PAGES", d.maxPages),
    detailLimit: n("DETAIL_LIMIT", d.detailLimit),
  };
}

// ---------------------------------------------------------------------------
// Full-catalogue walk (2026-10-19): every listed product, reduced AND full
// price, for brands whose search should reach the whole shop. The feed still
// shows only the reduced rows (listPrice set); full-price rows carry
// `listPrice: null`. Lacoste, Damas, MAC and Koton do not use this.
// ---------------------------------------------------------------------------

/**
 * The listing search stops at row 10,000 (Elasticsearch's result window, see
 * koton.ts): page 41 of 250 comes back empty on every Akinon shop measured
 * (FashFed 2026-10-19). A listing past it is walked twice, by price ascending
 * and descending (every Akinon shop offers the `price` / `-price` sorters),
 * which reaches up to twice the window.
 */
export const RESULT_WINDOW = 10_000;
/** Akinon caps page_size at 250 (koton.ts); the biggest page is the cheapest walk. */
export const FULL_PAGE_SIZE = 250;

export interface AkinonWalk {
  /** Every row of every page, in page order (a row can repeat if the listing shifts mid-walk). */
  rows: any[];
  /** Page 1 of the unsorted listing (facets, pagination). */
  first: any;
  requests: number;
}

/** Tunables of a full walk. */
export interface AkinonCatalogueLimits extends AkinonLimits {
  /** Wall-clock budget for the whole adapter; the PDP (sizes) pass stops when it runs out. */
  budgetMs?: number;
  /** Requests in flight at once (listing pages and PDPs). */
  concurrency?: number;
}

const withQuery = (path: string, q: string) => (q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path);

/**
 * True when a price-ascending walk whose dearest row is `ascMax` and a
 * price-descending walk whose cheapest row is `descMin` together cover the
 * listing: the ascending walk holds every row cheaper than `ascMax`, the
 * descending one every row dearer than `descMin`, so `descMin < ascMax` leaves
 * no row out, however ties at either boundary were ordered.
 */
export function sortedHalvesCover(ascMax: number, descMin: number): boolean {
  return Number.isFinite(ascMax) && Number.isFinite(descMin) && descMin < ascMax;
}

/**
 * Every row of one Akinon listing (`path` may carry filters), 250 per page.
 *
 * Fails loudly rather than returning part of the listing: a page that still
 * fails after retries, a listing over `maxPages`, or one past twice the result
 * window throws, because the collector marks every product it did not see as
 * out of stock — a silent half-walk would sell out half the shop.
 */
export async function walkAkinonListing(
  site: string,
  path: string,
  opts: { maxPages: number; concurrency?: number },
): Promise<AkinonWalk> {
  const concurrency = opts.concurrency ?? CONCURRENCY;
  let requests = 0;
  const get = async (p: string, n: number) => {
    requests++;
    return getJson<any>(`${site}${withQuery(p, `format=json&page_size=${FULL_PAGE_SIZE}&page=${n}`)}`);
  };
  const pagesOf = (body: any) => Math.max(1, Number(body?.pagination?.num_pages ?? 1) || 1);

  /** Pages 2..n of `p` after `firstBody`, rows in page order. */
  const rest = async (p: string, firstBody: any, n: number): Promise<any[]> => {
    const bodies: any[][] = [firstBody?.products ?? []];
    await pool(Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 2), concurrency, async (k) => {
      bodies[k - 1] = (await get(p, k))?.products ?? [];
    });
    return bodies.flat();
  };

  const first = await get(path, 1);
  const total = Number(first?.pagination?.total_count ?? 0);
  const windowPages = Math.ceil(RESULT_WINDOW / FULL_PAGE_SIZE);

  if (total <= RESULT_WINDOW) {
    const n = pagesOf(first);
    if (n > opts.maxPages) throw new Error(`akinon: ${site}${path} has ${n} pages, over the cap of ${opts.maxPages}`);
    return { rows: await rest(path, first, n), first, requests };
  }

  // Past the window: price ascending up to the window, then descending for the
  // remainder plus two pages of overlap, and prove the halves meet.
  const descPages = Math.ceil((total - RESULT_WINDOW) / FULL_PAGE_SIZE) + 2;
  if (total > 2 * RESULT_WINDOW - 2 * FULL_PAGE_SIZE || windowPages + descPages > opts.maxPages) {
    throw new Error(`akinon: ${site}${path} lists ${total} rows, more than a sorted walk can reach (cap ${opts.maxPages} pages)`);
  }
  const ascPath = withQuery(path, "sorter=price");
  const descPath = withQuery(path, "sorter=-price");
  const [ascFirst, descFirst] = [await get(ascPath, 1), await get(descPath, 1)];
  const asc = await rest(ascPath, ascFirst, Math.min(windowPages, pagesOf(ascFirst)));
  const desc = await rest(descPath, descFirst, Math.min(descPages, pagesOf(descFirst)));
  const prices = (rows: any[]) => rows.map((r) => parseFloat(r?.price)).filter(Number.isFinite);
  if (!sortedHalvesCover(Math.max(...prices(asc)), Math.min(...prices(desc)))) {
    throw new Error(`akinon: ${site}${path} price-sorted halves do not meet; the walk would miss rows`);
  }
  return { rows: [...asc, ...desc], first, requests };
}

/**
 * Fill sizes for records whose listing row did not embed them, one PDP each:
 * the reduced ones first, then full price, each shuffled so coverage rotates
 * across runs (the upsert keeps earlier variants). Bounded by `limit` and by
 * the wall clock. Returns the requests made.
 */
export async function fillAkinonSizes(
  records: ProductRecord[],
  site: string,
  limit: number,
  fetchVariants: (url: string) => Promise<ProductVariants | null>,
  opts: { deadline: number; concurrency?: number },
): Promise<number> {
  const shuffle = <T>(a: T[]) => {
    for (let j = a.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [a[j], a[k]] = [a[k], a[j]];
    }
    return a;
  };
  const missing = records.filter((r) => !r.variants && r.url.startsWith(site) && r.url !== site);
  const queue = [
    ...shuffle(missing.filter((r) => r.listPrice != null)),
    ...shuffle(missing.filter((r) => r.listPrice == null)),
  ].slice(0, limit);
  let requests = 0;
  await pool(queue, opts.concurrency ?? CONCURRENCY, async (r) => {
    if (Date.now() > opts.deadline) return;
    requests++;
    const v = await fetchVariants(r.url);
    if (!v) return;
    r.variants = v;
    r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
  });
  return requests;
}

/** Map walked rows into records, one per colour (the last row of an id wins, as in listAkinon). */
export function akinonRecords(rows: any[], map: (p: any) => ProductRecord | null): ProductRecord[] {
  const byId = new Map<string, ProductRecord>();
  for (const p of rows) {
    const r = map(p);
    if (r) byId.set(r.externalId, r);
  }
  return [...byId.values()];
}

/**
 * The whole catalogue of `shop.listPath` (normally `/list/`): reduced rows
 * exactly as listAkinon maps them, plus every full-price row with
 * `listPrice: null`. Throws instead of returning a partial catalogue.
 */
export async function listAkinonCatalogue(shop: AkinonShop, limits: AkinonCatalogueLimits): Promise<ProductRecord[]> {
  const started = Date.now();
  const walk = await walkAkinonListing(shop.site, shop.listPath, { maxPages: limits.maxPages, concurrency: limits.concurrency });
  const records = akinonRecords(walk.rows, (p) => mapAkinonProduct(shop, p));
  if (records.length > limits.maxProducts) {
    throw new Error(`akinon: ${shop.brand} catalogue has ${records.length} products, over the cap of ${limits.maxProducts}`);
  }
  await fillAkinonSizes(records, shop.site, limits.detailLimit, (url) => fetchPdpVariants(shop, url), {
    deadline: started + (limits.budgetMs ?? 200_000),
    concurrency: limits.concurrency,
  });
  return records;
}
