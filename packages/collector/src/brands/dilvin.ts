/**
 * Dilvin — women's clothing, dilvin.com.tr (2026-10-23). The shop runs on
 * Kobimaster (ASP.NET, Cloudflare in front, no challenge); a GitHub runner and
 * this Mac get the same answers with no proxy (probe run 40021682773).
 *
 * LISTING. Every category page embeds `PageQueryParams = {…}` (category id,
 * page size, total). The "load more" XHR replays it:
 *
 *   GET /store/svc/prd-list-svc.aspx?NextPageNumber=N&PageQueryParams=<json>   (header X-KM: v9)
 *
 * and answers HTML cards. `PageSize` is honoured up to at least 3,000, so the
 * whole shop is a handful of requests. The two root categories are KOLEKSİYON
 * (3,201 in-stock cards on 2026-10-23 — every clothing shelf hangs under it)
 * and AKSESUAR (36, not under KOLEKSİYON). `StockFilter: true` is what the shop
 * itself sends: only in-stock cards, so a product that sells out drops off the
 * walk and the run's sweep marks it out of stock.
 *
 * PRICES. A reduced card shows `price-standard` (struck) and `price-sales`
 * (charged), "1.499,99 TL" format; a full-price card only `price-sales`. Only
 * 58 of 3,201 were reduced that day ("İndirim" redirects to /internete-ozel),
 * so the full catalogue is kept, like the other small Turkish shops.
 *
 * SIZES. Not on the card: `/skins/shared/svc/prd-variant-new.aspx?type=variants
 * &prdid=<id>` answers one button per size, `btn-buy disabled` when sold out.
 * A rotating subset per run (every deal is covered within a few runs).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "dilvin";
export const SITE = "https://www.dilvin.com.tr";
/** The two root listings: every clothing shelf hangs under KOLEKSİYON; AKSESUAR stands apart. */
const ROOTS = ["/koleksiyon", "/aksesuar"];
const PAGE_SIZE = Number(process.env.DILVIN_PAGE_SIZE ?? 1000);
const MAX_PRODUCTS = Number(process.env.DILVIN_MAX_PRODUCTS ?? 8000);
const DEAL_SIZES = Number(process.env.DILVIN_DEAL_SIZES ?? 30);
const FULL_SIZES = Number(process.env.DILVIN_FULL_SIZES ?? 15);
const PAUSE_MS = Number(process.env.DILVIN_PAUSE_MS ?? 400);
const HEADERS = { "X-KM": "v9", "X-Requested-With": "XMLHttpRequest" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/** "1.499,99 TL" → 1499.99 */
export function parseTl(s: string | undefined | null): number {
  const m = String(s ?? "").match(/([\d.]+(?:,\d{1,2})?)/);
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : NaN;
}

/** The `PageQueryParams = {…}` object a category page embeds. */
export function pageQueryParams(html: string): Record<string, any> | null {
  const m = html.match(/PageQueryParams\s*=\s*(\{.*\})/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Map every card in a listing HTML chunk. Pure. */
export function mapDilvinCards(html: string): ProductRecord[] {
  const out: ProductRecord[] = [];
  for (const card of html.split(/(?=<div class="item itemauto)/).slice(1)) {
    const attr = (name: string) => card.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const id = card.match(/data-prdid="(\d+)"/)?.[1];
    const path = attr("data-dlurl");
    const name = decode(attr("data-dlname") ?? "");
    const sale = parseTl(card.match(/class="price-sales">([^<]*)</)?.[1]);
    const struck = parseTl(card.match(/class="price-standard">([^<]*)</)?.[1]);
    if (!id || !path || !name || !Number.isFinite(sale) || sale <= 0) continue;
    const imgs = [...card.matchAll(/data-src='([^']+)'/g)].map((m) => `${SITE}/${m[1].replace(/^\//, "")}`);
    const first = card.match(/<img src='([^']+)'/)?.[1];
    const firstUrl = first ? `${SITE}/${first.replace(/^\//, "")}` : imgs[0] ?? null;
    // data-sku "101A71440_Koyu Mavi": the colour after the model code.
    const colour = attr("data-sku")?.split("_").slice(1).join(" ").trim() || null;
    out.push({
      brand,
      country: "TR",
      externalId: id,
      name,
      url: `${SITE}${path.startsWith("/") ? path : `/${path}`}`,
      imageUrl: firstUrl,
      images: cleanGallery(imgs, firstUrl),
      price: toMinor(sale),
      listPrice: Number.isFinite(struck) && struck - sale > 0.005 ? toMinor(struck) : null,
      currency: "TRY",
      // The walk asks for in-stock cards only (StockFilter), as the shop does.
      inStock: true,
      category: null,
      gender: "kadin",
      variants: null,
      colorName: colour ? decode(colour) : null,
    });
  }
  return out;
}

/** Sizes from the variant buttons: `btn-buy disabled` is a sold-out size. Pure. */
export function variantSizes(html: string): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<button class="btn-buy( disabled)?"[^>]*>([^<]*)<\/button>/g)) {
    const label = decode(m[2]);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: m[1] ? "out_of_stock" : "in_stock" });
  }
  return out;
}

export function listSvcUrl(pq: Record<string, any>, page: number): string {
  const q = new URLSearchParams({ NextPageNumber: String(page), PageQueryParams: JSON.stringify(pq) });
  return `${SITE}/store/svc/prd-list-svc.aspx?${q}`;
}

/** One root category, whole. A failed or short walk throws: a partial walk would sweep live cards. */
async function walkRoot(path: string, count: () => void): Promise<ProductRecord[]> {
  count();
  const seed = pageQueryParams(await getText(`${SITE}${path}`, { timeoutMs: 30_000 }));
  const total = Number(seed?.TotalItems);
  if (!seed || !Number.isFinite(total)) throw new Error(`dilvin: no PageQueryParams on ${path}`);
  const pq = { ...seed, PageSize: PAGE_SIZE, CurrentPage: 1, StockFilter: true };
  const pages = Math.ceil(total / PAGE_SIZE);
  const rows: ProductRecord[] = [];
  for (let n = 1; n <= pages; n++) {
    await sleep(PAUSE_MS);
    count();
    const html = await getText(listSvcUrl(pq, n), { headers: HEADERS, timeoutMs: 60_000 }).catch((e) => {
      throw new Error(`dilvin: ${path} page ${n} failed (${e?.message ?? e})`);
    });
    const got = mapDilvinCards(html);
    if (!got.length) throw new Error(`dilvin: ${path} page ${n} of ${pages} came back empty`);
    rows.push(...got);
  }
  const distinct = new Set(rows.map((r) => r.externalId)).size;
  if (distinct < total * 0.99) throw new Error(`dilvin: ${path} walked ${distinct} of ${total} cards`);
  return rows;
}

const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let j = a.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [a[j], a[k]] = [a[k], a[j]];
  }
  return a;
};

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  let requests = 0;
  const byId = new Map<string, ProductRecord>();
  for (const root of ROOTS) for (const r of await walkRoot(root, () => requests++)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
  const all = [...byId.values()];
  if (all.length > MAX_PRODUCTS) throw new Error(`dilvin: ${all.length} cards, over the cap of ${MAX_PRODUCTS}`);
  const deals = all.filter((r) => r.listPrice != null);
  const full = all.filter((r) => r.listPrice == null);

  for (const r of [...shuffle(deals).slice(0, DEAL_SIZES), ...shuffle(full).slice(0, FULL_SIZES)]) {
    await sleep(PAUSE_MS);
    requests++;
    const html = await getText(`${SITE}/skins/shared/svc/prd-variant-new.aspx?type=variants&prdid=${r.externalId}`, {
      headers: HEADERS,
      timeoutMs: 15_000,
    }).catch(() => "");
    const sizes = variantSizes(html);
    if (!sizes.length) continue;
    r.variants = { colors: [], sizes };
    r.inStock = sizes.some((s) => s.availability === "in_stock");
  }
  if (process.env.DILVIN_DEBUG) console.error(`dilvin: ${requests} requests, ${all.length} cards, ${deals.length} deals`);
  return [...deals.filter((r) => r.inStock), ...full, ...deals.filter((r) => !r.inStock)];
}
