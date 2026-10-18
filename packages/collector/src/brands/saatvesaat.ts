import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Saat&Saat — Turkey's multi-brand watch retailer (`saatvesaat.com.tr`,
 * Magento 2 + Hyvä behind Cloudflare). Its listing pages are filled by a
 * public Elasticsearch proxy, `/elastic.php`, which answers a GitHub runner
 * directly (probe run 39124158963, 2026-10-18). Magento's `/graphql` does NOT:
 * Cloudflare 403s it from the runner (GET and POST), though it answers the Mac.
 *
 * `order=discount_rate&direction=desc` sorts the whole in-stock catalogue
 * (~14.8k rows) by markdown, so the walk reads only the reduced head and stops
 * at the first page with no reduction: ~2,300 rows in ~39 pages of 60 (the
 * proxy caps `size` at 60), 2026-10-18. The index carries in-stock rows only.
 *
 * Prices: `price` is the list price, `special_price` the shelf price (the same
 * pair Magento's GraphQL returns as regular/final — checked on 8 SKUs).
 * `cart_price` is a "Sepette N TL indirim" basket coupon and is never quoted
 * (Boyner's rule).
 */
export const SITE = "https://www.saatvesaat.com.tr";
export const IMAGE_PREFIX = "https://cdn.saatvesaat.com.tr/mnresize/740/-/media/catalog/product";
const PAGE_SIZE = 60; // the proxy's own maximum
const MAX_PRODUCTS = Number(process.env.SAATVESAAT_MAX_PRODUCTS ?? 2500);
const MAX_PAGES = Number(process.env.SAATVESAAT_MAX_PAGES ?? 45);
const PAUSE_MS = Number(process.env.SAATVESAAT_PAUSE_MS ?? 400);

export const brand = "saatvesaat";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "")));
const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").toLowerCase();

export function genderOf(s: any): ProductRecord["gender"] {
  const g: string[] = Array.isArray(s?.gender) ? s.gender.map((x: unknown) => fold(String(x))) : [];
  if (g.includes("cocuk")) return "cocuk";
  const k = g.includes("kadin");
  const e = g.includes("erkek");
  if (k && !e) return "kadin";
  if (e && !k) return "erkek";
  return null; // both, or none: unisex
}

/**
 * The shelf the shopper sees. Watches use the breadcrumb leaf ("Kadın Klasik
 * Saat", "Erkek Akıllı Saat"); everything else its product type ("Bileklik",
 * "Kolye", "Çanta"). Gift sets ("Set") are filed by what is in them — the
 * breadcrumb puts a Calvin Klein bracelet set under "Erkek Hediye Seti".
 */
export function categoryOf(s: any): string | null {
  const ptype = typeof s?.ptype === "string" ? s.ptype.trim() : "";
  if (ptype === "Set") return /saat/.test(fold(String(s?.name ?? ""))) ? "Saat Seti" : "Takı Seti";
  if (ptype === "Saat") {
    try {
      const crumbs = JSON.parse(s?.breadcrumb ?? "[]");
      const leaf = Array.isArray(crumbs) ? crumbs[crumbs.length - 1]?.name : null;
      if (typeof leaf === "string" && /saat/i.test(fold(leaf))) return leaf.trim();
    } catch { /* fall through */ }
    return "Saat";
  }
  return ptype || null;
}

/** "GUW0911L3 Kadın Kol Saati" → "Guess GUW0911L3 Kadın Kol Saati": the name alone never says the brand. */
export function nameOf(s: any): string {
  const name = String(s?.name ?? "").replace(/\s+/g, " ").trim();
  const b = typeof s?.brand === "string" ? s.brand.trim() : "";
  return b && !fold(name).startsWith(fold(b)) ? `${b} ${name}` : name;
}

export const imageUrl = (path: unknown) =>
  typeof path === "string" && path.startsWith("/") ? `${IMAGE_PREFIX}${path}` : null;

/** Map one elastic hit's `_source`. Pure. Prices are major-unit TRY numbers. */
export function mapSaatvesaat(s: any): ProductRecord | null {
  if (!s?.sku || !s?.url_key || !s?.name) return null;
  const list = num(s.price);
  const special = num(s.special_price);
  if (!Number.isFinite(list) || list <= 0) return null;
  const price = Number.isFinite(special) && special > 0 && special < list ? special : list;
  const first = imageUrl(s.image);
  const extra = String(s.additional_images ?? "").split(",").map((p) => imageUrl(p.trim()));
  const barcode = String(s.barcode ?? "").trim();
  const dial = Array.isArray(s.kadran_renk) ? s.kadran_renk.filter(Boolean) : [];
  return {
    brand,
    country: "TR",
    externalId: String(s.sku),
    name: nameOf(s),
    url: `${SITE}/${s.url_key}`,
    imageUrl: first,
    images: cleanGallery(extra, first),
    price: toMinor(price),
    listPrice: price < list ? toMinor(list) : null,
    currency: "TRY",
    inStock: Number(s.is_in_stock) === 1,
    barcodes: /^\d{8,14}$/.test(barcode) ? [barcode] : null,
    category: categoryOf(s),
    gender: genderOf(s),
    variants: null,
    colorName: dial.length === 1 ? String(dial[0]) : null,
  };
}

export const pageUrl = (from: number) =>
  `${SITE}/elastic.php?categoryId=2&order=discount_rate&direction=desc&from=${from}&size=${PAGE_SIZE}`;

export const HEADERS = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };

async function page(from: number): Promise<any[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getJson<any>(pageUrl(from), { retries: 0, headers: HEADERS, timeoutMs: 20_000 }).catch(() => null);
    const hits = data?.product?.hits?.hits;
    if (Array.isArray(hits)) return hits.map((h: any) => h?._source).filter(Boolean);
    await sleep(3000 * (attempt + 1));
  }
  return null;
}

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  for (let n = 0; n < MAX_PAGES && byId.size < MAX_PRODUCTS; n++) {
    if (n > 0) await sleep(PAUSE_MS);
    const rows = await page(n * PAGE_SIZE);
    if (rows === null) {
      if (byId.size === 0) throw new Error(`saatvesaat: elastic.php page ${n + 1} refused`);
      break;
    }
    let reduced = 0;
    for (const s of rows) {
      const r = mapSaatvesaat(s);
      if (r && r.listPrice != null) {
        reduced++;
        byId.set(r.externalId, r);
      }
    }
    // Sorted by markdown: the first page without one is the end of the sale.
    if (rows.length < PAGE_SIZE || reduced === 0) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
