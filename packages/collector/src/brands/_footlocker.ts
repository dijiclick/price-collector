/**
 * Foot Locker Inc. banners (footlocker.com, champssports.com) — multi-brand
 * sneaker/sport stores, sale category only.
 *
 * Every JSON route (`/api/*`, `/zgw/search-core/…`, `/apigate/*`) is guarded by
 * Kasada and answers 403 to scripted clients. The sale category pages
 * themselves are served whole to a GitHub runner, server-rendered, with the
 * listing embedded in `window.footlocker = { STATE_FROM_SERVER: {…} }` as
 * `"pagination":{…},"products":[…]`, 48 products a page (probe runs
 * 39652616960, 39653295633, 39654225229 — 2026-10-21). The walk reads the
 * site's own sale sub-categories (`/category/sale/womens/shoes.html`, …): the
 * CDN answered `?currentPage=2+` with page 0 again, so deep pages are only
 * kept while the embedded pagination agrees. (From the Turkish Mac the .com
 * sites geo-redirect to footlocker.eu — test from a runner.)
 *
 * Now and then a runner is handed a ~2 KB Kasada shell (`kpsdk-load`, no
 * page body) instead of the page, for one URL at a time, and the same URL is
 * whole again a minute later (probe runs 39681802513, 39684561862 on 2026-10-21:
 * champssports kids/clothing and adidas 2 KB, then 0.7 / 1.9 MB with the
 * listing). Such a page is fetched again after a pause, and a slice that still
 * has no listing is skipped; the banner fails only when most slices do.
 *
 * Each product has `price.value` (selling) and `originalPrice.value` (the price
 * the site strikes through). Rows are kept only when original > price, and
 * dropped when another colour of the same product is flagged as a member-only
 * sale at that price. The page is ~2 MB, so pages are capped per banner.
 * The listing has no brand field; `maker` is read from the name's leading words
 * against a list of the brands these stores carry.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export type FlBanner = "footlocker" | "champssports";

export const FL_SITES: Record<FlBanner, Partial<Record<CountryCode, { site: string; base: string; currency: string }>>> = {
  footlocker: {
    US: { site: "https://www.footlocker.com", base: "/category/sale", currency: "USD" },
    // Served whole to a runner (200, 1.9 MB, "All Sale | Foot Locker Canada", probe 39653987560);
    // the embedded listing sits past the probe's 400 KB window, so its shape is assumed = US.
    CA: { site: "https://www.footlocker.ca", base: "/en/category/sale", currency: "CAD" },
  },
  champssports: {
    US: { site: "https://www.champssports.com", base: "/category/sale", currency: "USD" },
  },
};

/**
 * Sale sub-categories (the site's own links under /category/sale), with the
 * section gender and how many pages to try. Page 0 of each is what the CDN
 * reliably serves; deeper `?currentPage=N` pages are read only while the
 * embedded pagination agrees (a runner was sometimes handed page 0 again).
 */
export const FL_SLICES: [path: string, gender: ProductRecord["gender"], pages: number][] = [
  ["/womens/shoes", "kadin", 2],
  ["/womens/clothing", "kadin", 2],
  ["/womens/accessories", "kadin", 1],
  ["/mens/shoes", "erkek", 3],
  ["/mens/clothing", "erkek", 3],
  ["/mens/accessories", "erkek", 1],
  ["/kids/shoes", "cocuk", 2],
  ["/kids/clothing", "cocuk", 1],
  ["/nike", null, 2],
  ["/adidas", null, 1],
  ["/jordan", null, 1],
  ["/new-balance", null, 1],
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CAP = 1500;
const PAUSE_MS = Number(process.env.FL_PAUSE_MS ?? 1200);
/** Waits before fetching a page again that came back without its listing. */
const SHELL_RETRY_MS = [3000, 8000].map((ms) => (process.env.FL_PAUSE_MS === "0" ? 0 : ms));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Brands these banners carry, longest first so "adidas Originals" wins over "adidas". */
const MAKERS = [
  "adidas Originals", "adidas", "Jordan", "Nike", "New Balance", "On", "PUMA", "Puma", "ASICS", "Converse", "Vans",
  "Timberland", "UGG", "Crocs", "LCKR", "HOKA", "Hoka", "Reebok", "Under Armour", "The North Face", "Champion",
  "Saucony", "Brooks", "Salomon", "Birkenstock", "Dr. Martens", "Clarks", "Columbia", "Carhartt", "Levi's",
  "Mitchell & Ness", "New Era", "Fila", "Lacoste", "Psychic Hearts", "Cozi", "Nautica", "Sorel", "Skechers",
  "Merrell", "Ellesse", "Kappa", "Champion Reverse Weave", "Essentials", "CSG", "Lace Lab",
].sort((a, b) => b.length - a.length);

export function makerOfName(name: string): string | null {
  for (const m of MAKERS) {
    if (name === m || name.startsWith(`${m} `)) return m === "Puma" ? "PUMA" : m === "Hoka" ? "HOKA" : m;
  }
  return null;
}

export const pageUrl = (b: FlBanner, c: CountryCode, slice: string, page: number) => {
  const s = FL_SITES[b][c]!;
  return `${s.site}${s.base}${slice}.html${page > 0 ? `?currentPage=${page}` : ""}`;
};

/** The JSON value starting at `start` ("[" or "{"), found by bracket matching outside strings. */
export function sliceJson(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** The search listing embedded in the page: products and pagination. */
export function parseFlPage(html: string): { products: any[]; pagination: any } | null {
  const p = html.indexOf('"pagination":{"currentPage"');
  if (p < 0) return null;
  const pag = sliceJson(html, p + '"pagination":'.length);
  const q = html.indexOf('"products":[', p);
  if (q < 0 || !pag) return null;
  const arr = sliceJson(html, q + '"products":'.length);
  if (!arr) return null;
  return { products: JSON.parse(arr), pagination: JSON.parse(pag) };
}

function genderOf(name: string, fallback: ProductRecord["gender"]): ProductRecord["gender"] {
  const tail = name.split(" - ").pop() ?? "";
  if (/boys'|girls'|grade school|preschool|toddler|infant|kids'/i.test(tail)) return "cocuk";
  if (/women's/i.test(tail)) return "kadin";
  if (/men's/i.test(tail)) return "erkek";
  return fallback;
}

/** Map one listing product. Pure; null unless genuinely reduced and not a member-only price. */
export function mapFl(p: any, banner: FlBanner, country: CountryCode, gender: ProductRecord["gender"] = null): ProductRecord | null {
  const s = FL_SITES[banner][country];
  const sku = typeof p?.sku === "string" ? p.sku : "";
  const name = typeof p?.name === "string" ? p.name.trim() : "";
  if (!s || !sku || !name) return null;
  const price = Number(p?.price?.value);
  const list = Number(p?.originalPrice?.value);
  if (!(price > 0) || !(list > price)) return null;
  const variants: any[] = Array.isArray(p.variantOptions) ? p.variantOptions : [];
  if (variants.some((v) => v?.flagsAndRestrictions?.isMemberOnlySale && Number(v?.price?.salePrice) === price)) return null;
  const raw = Array.isArray(p.images) ? p.images.find((im: any) => typeof im?.url === "string")?.url : null;
  const img = raw ? `${raw}?wid=800&hei=800&fmt=png-alpha` : null;
  const colour = p?.baseOptions?.[0]?.selected?.style;
  return {
    brand: banner,
    country,
    externalId: sku,
    name,
    url: `${s.site}${s.base.startsWith("/en/") ? "/en" : ""}/product/~/${encodeURIComponent(sku)}.html`,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: s.currency,
    inStock: true,
    category: null,
    maker: makerOfName(name),
    gender: genderOf(name, gender),
    variants: null,
    groupKey: p.baseProduct ? `${banner}-${p.baseProduct}` : null,
    colorName: typeof colour === "string" && colour ? colour : null,
  };
}

/** One listing page, fetched again while it comes back without its listing (Kasada shell). Null if it never does. */
async function fetchListing(banner: FlBanner, country: CountryCode, slice: string, page: number) {
  const url = pageUrl(banner, country, slice, page);
  let html = "";
  for (let attempt = 0; attempt <= SHELL_RETRY_MS.length; attempt++) {
    if (attempt > 0) await sleep(SHELL_RETRY_MS[attempt - 1]);
    html = await getText(url, {
      country,
      timeoutMs: 45_000,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    const got = parseFlPage(html);
    if (got) return got;
  }
  console.warn(`${banner}/${country}: ${slice} p${page} has no embedded listing (${html.length} bytes: ${html.slice(0, 80).replace(/\s+/g, " ")})`);
  return null;
}

export async function listFootLocker(banner: FlBanner, country: CountryCode): Promise<ProductRecord[]> {
  const s = FL_SITES[banner][country];
  if (!s) return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  const missed: string[] = [];
  for (const [slice, gender, pages] of FL_SLICES) {
    for (let page = 0; page < pages; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const got = await fetchListing(banner, country, slice, page);
      if (!got) {
        if (page === 0) missed.push(slice);
        break;
      }
      if (Number(got.pagination?.currentPage) !== page) {
        console.warn(`${banner}/${country}: ${slice} asked page ${page}, served ${got.pagination?.currentPage}; next slice`);
        break;
      }
      for (const p of got.products) {
        const r = mapFl(p, banner, country, gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (page + 1 >= Number(got.pagination?.totalPages ?? 0)) break;
    }
  }
  // A wall (or a layout change) shows up as most slices without a listing.
  if (missed.length * 2 > FL_SLICES.length) {
    throw new Error(`${banner}/${country}: ${missed.length}/${FL_SLICES.length} sale slices had no embedded listing (wall or layout change)`);
  }
  if (!byId.size) throw new Error(`${banner}/${country}: the sale listings had no reduced product`);
  if (missed.length) console.warn(`${banner}/${country}: skipped ${missed.join(", ")} (no listing)`);
  return [...byId.values()].slice(0, CAP);
}
