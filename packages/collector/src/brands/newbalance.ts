import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";

/**
 * New Balance Turkey (newbalance.com.tr) is a Next.js storefront whose pages
 * are server-rendered from one product-search backend. The browser never calls
 * that backend itself, but Next serves every page's props as JSON at
 * `/_next/data/<buildId>/<path>.json`, and that is the cheapest clean route:
 * the `indirim` page's props are the discounted products with per-barcode
 * stock (`stocksByBarcode`, 1/0) and the barcode → size label map, so sizes
 * need no detail call.
 *
 * The build id changes on every deploy, so it is read from the home page's
 * `__NEXT_DATA__` at the start of each run (one request).
 *
 * Measured 2026-10-10: 284 discounted products, 12 per page (the backend
 * ignores a larger page size), so ~24 page requests.
 *
 * FULL CATALOGUE (2026-10-19): the search page with no query (`arama`) lists
 * the whole range — 774 products, a superset of `indirim` 291, `kadin` 522 and
 * `erkek` 369 (all checked) — and only in-stock ones. 65 pages, ~10 s. Full
 * price rows have `listPrice: null`. A failed page, a page cap, or a walk >1%
 * short of the backend's own `totalItems` THROWS: the run's sweep would mark
 * anything unseen as sold out.
 */
const SITE = "https://www.newbalance.com.tr";
const IMG = "https://newbalance.sm.mncdn.com/";
const MAX_PAGES = Number(process.env.NEWBALANCE_MAX_PAGES ?? 250); // 3,000 products
const PAUSE_MS = Number(process.env.NEWBALANCE_PAUSE_MS ?? 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `buildId` out of a Next page's `__NEXT_DATA__`. */
export function buildIdOf(html: string): string | null {
  return html.match(/"buildId":"([^"]+)"/)?.[1] ?? null;
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL"];
function sizeRank(label: string): number {
  const n = Number(label.replace(",", "."));
  if (Number.isFinite(n)) return n;
  const i = SIZE_ORDER.indexOf(label.toUpperCase());
  return i >= 0 ? 1000 + i : 2000;
}

/** Per-size stock from the barcode list and its `stocksByBarcode` map. */
export function sizesOf(p: any): SizeVariant[] {
  const stock: Record<string, number> = p?.stocksByBarcode ?? {};
  const seen = new Set<string>();
  const out: SizeVariant[] = [];
  for (const b of p?.barcodes ?? []) {
    const label = String(b?.stockTypeValues?.[0]?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const qty = Number(stock[String(b.id)] ?? 0);
    out.push({ label, availability: qty > 0 ? "in_stock" : "out_of_stock" });
  }
  return out.sort((a, b) => sizeRank(a.label) - sizeRank(b.label));
}

function attr(p: any, code: string): string | null {
  const a = (p?.attributes ?? []).find((x: any) => x?.attribute?.integrationCode === code);
  const v = a?.attributeValues?.[0]?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function genderOf(p: any): ProductRecord["gender"] {
  const g = attr(p, "attr_gender") ?? "";
  if (/kad[ıi]n/i.test(g)) return "kadin";
  if (/erkek/i.test(g)) return "erkek";
  if (/[çc]ocuk|bebek|gen[çc]/i.test(g)) return "cocuk";
  return null; // Unisex
}

/** Photos of this colour, default first; documents are relative CDN paths. */
function photosOf(p: any): string[] {
  const docs: any[] = (p?.documents ?? []).filter(
    (d: any) => d?.documentType === "Image" && typeof d?.filePath === "string",
  );
  docs.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
  return docs.map((d) => IMG + String(d.filePath).replace(/^\/+/, ""));
}

export function mapProduct(p: any): ProductRecord | null {
  const id = p?.id;
  const price = Number(p?.salesPrice ?? p?.discountPrice);
  if (!id || !p?.name || !Number.isFinite(price) || price <= 0) return null;
  const base = Number(p.basePrice);
  const sizes = sizesOf(p);
  const photos = photosOf(p);
  const cats: any[] = p.categories ?? [];
  const cat = cats.find((c) => c?.isDefault) ?? cats[cats.length - 1];
  const colour = attr(p, "attr_color");
  const variations: number[] = (p.variations ?? []).map(Number).filter(Number.isFinite);
  return {
    brand: "newbalance",
    externalId: String(id),
    name: String(p.name).replace(/\s+/g, " ").trim(),
    url: `${SITE}/urun/${p.routePath}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(base) && base > price ? toMinor(base) : null,
    currency: "TRY",
    inStock: sizes.length > 0 ? sizes.some((s) => s.availability !== "out_of_stock") : true,
    category: cat?.name ?? null,
    gender: genderOf(p),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    // `variations` lists the ids of every colour of this model, itself included.
    groupKey: variations.length > 1 ? `newbalance:${Math.min(...variations)}` : null,
    colorName: colour,
  };
}

export const brand = "newbalance";

export async function listProducts(): Promise<ProductRecord[]> {
  // NB getText's `proxy` means ALWAYS proxy (unlike getJson's fallback), so not here.
  const home = await getText(`${SITE}/`);
  const buildId = buildIdOf(home);
  if (!buildId) throw new Error("newbalance: no Next buildId on the home page");

  const byId = new Map<string, ProductRecord>();
  let total = 0;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`newbalance: over ${MAX_PAGES} pages — raise NEWBALANCE_MAX_PAGES`);
    if (page > 1) await sleep(PAUSE_MS);
    const url = `${SITE}/_next/data/${buildId}/arama.json?page=${page}`;
    const data = await getJson<any>(url, { proxy: true, retries: 2 }).catch((e) => {
      throw new Error(`newbalance: page ${page} failed (${e?.message ?? e})`);
    });
    const res = data?.pageProps?.data?.response;
    total = Number(res?.totalItems ?? 0);
    const list: any[] = res?.products ?? [];
    for (const p of list) {
      const r = mapProduct(p);
      if (r) byId.set(r.externalId, r);
    }
    if (list.length === 0 || page >= Number(res?.totalPages ?? 1)) break;
  }
  if (!total || byId.size < total * 0.99) throw new Error(`newbalance: walked ${byId.size} of ${total} products`);
  return [...byId.values()];
}
