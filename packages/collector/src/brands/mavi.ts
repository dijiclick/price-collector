import { cleanGallery, type ProductRecord, type ProductVariants, type SizeVariant } from "../types";
import { toMinor } from "../normalize";
import { browserJson } from "../../../../lib/live-brands/_browser";

/**
 * Mavi (mavi.com) is SAP Commerce: the Angular storefront reads the OCC API at
 * `p1-api.mavi.com/maviwebservices/v2/mavi/…`. Cloudflare answers 403 to
 * curl and to Node's default HTTP/1.1 fetch; the shared browser-shaped HTTP/2
 * fetch gets 200 (measured 2026-10-10). No auth.
 *
 * `products/search?query=:sale:allCategories:<c>` sorts by discount rate, so
 * each section (1 Kadın, 2 Erkek, 3 Çocuk) is paged until a page holds no
 * discounted row. A discounted row has `salePrice` under `price`.
 * Product detail (~17 KB) has per-size stock in `variantOptions`; a small
 * rotating subset is read per run (the upsert keeps earlier captures).
 */
const SITE = "https://www.mavi.com";
const API = "https://p1-api.mavi.com/maviwebservices/v2/mavi";
const SECTIONS: { cat: number; gender: ProductRecord["gender"] }[] = [
  { cat: 1, gender: "kadin" },
  { cat: 2, gender: "erkek" },
  { cat: 3, gender: "cocuk" },
];
const PAGE_SIZE = 100;
const MAX_PAGES = Number(process.env.MAVI_MAX_PAGES ?? 10);
const MAX_PRODUCTS = Number(process.env.MAVI_MAX_PRODUCTS ?? 2000);
const DETAIL_LIMIT = Number(process.env.MAVI_DETAIL_LIMIT ?? 60);
const api = <T = any>(path: string) =>
  browserJson<T>(`${API}${path}${path.includes("?") ? "&" : "?"}lang=tr&curr=TRY`, {
    timeoutMs: 30000,
    referer: `${SITE}/`,
  });

const img = (u: unknown): string | null =>
  typeof u === "string" && u ? (u.startsWith("//") ? `https:${u}` : u).replace("{x}", "820").replace("{y}", "1162") : null;

const genderOf = (g: unknown, fallback: ProductRecord["gender"]): ProductRecord["gender"] => {
  const s = String(g ?? "").toLocaleLowerCase("tr");
  if (/çocuk|bebek/.test(s)) return "cocuk";
  if (s.startsWith("kad")) return "kadin";
  if (s.startsWith("erkek")) return "erkek";
  return fallback;
};

export function maviPrice(p: any): { price: number; listPrice: number | null } | null {
  const list = Number(p?.price?.value);
  const sale = Number(p?.salePrice?.value);
  const price = Number.isFinite(sale) && sale > 0 ? sale : list;
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, listPrice: Number.isFinite(list) && list > price ? list : null };
}

/** A search (or detail) product → a record. */
export function mapProduct(p: any, fallback: ProductRecord["gender"]): ProductRecord | null {
  const pr = maviPrice(p);
  if (!p?.code || !pr) return null;
  const shots = ((p.galleryImagesNew?.length ? p.galleryImagesNew : (p.allMainImage ?? []).map((x: any) => x?.url)) as unknown[])
    .map(img)
    .filter((u): u is string => !!u);
  const first = shots[0] ?? img(p.mainImage?.url ?? p.images?.[0]?.url);
  const barcodes = (p.barcodes ?? []).map((b: unknown) => String(b).replace(/\D/g, "")).filter((b: string) => b.length >= 8 && b.length <= 14);
  // Jeans lead with their fit name ("MARCUS"), which the site prints before the title.
  const title = p.productTitle && !String(p.name ?? "").toUpperCase().includes(String(p.productTitle).toUpperCase())
    ? `${p.productTitle} ${p.name}` : String(p.name ?? "");
  return {
    brand: "mavi",
    country: "TR",
    externalId: String(p.code),
    barcodes: barcodes.length ? barcodes : null,
    name: title.trim(),
    url: p.url && !String(p.url).startsWith("/Kad") ? `${SITE}${p.url}` : `${SITE}/p/${p.code}`,
    imageUrl: first,
    images: cleanGallery(shots, first),
    price: toMinor(pr.price),
    listPrice: pr.listPrice != null ? toMinor(pr.listPrice) : null,
    currency: "TRY",
    inStock: p.comingSoon !== true && p.stock?.stockLevelStatus !== "outOfStock",
    category: p.mainCategories?.[0]?.name ?? null,
    gender: genderOf(p.gender?.name, fallback),
    groupKey: p.baseProduct ? `mavi:${p.baseProduct}` : null,
    colorName: p.colour?.name ?? null,
  };
}

/** Per-size stock from a product detail's `variantOptions` (jeans: waist/length). */
export function parseVariants(d: any): ProductVariants | null {
  const sizes: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of d?.variantOptions ?? []) {
    const q = (k: string) =>
      String((v?.variantOptionQualifiers ?? []).find((x: any) => x?.qualifier === k)?.value ?? "").trim();
    const label = [q("size"), q("length")].filter(Boolean).join("/");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const st = v?.stock?.stockLevelStatus;
    sizes.push({
      label,
      availability: st === "inStock" ? "in_stock" : st === "lowStock" ? "low_on_stock" : "out_of_stock",
    });
  }
  return sizes.length ? { colors: d?.colour?.name ? [String(d.colour.name)] : [], sizes } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const brand = "mavi";

/**
 * Cloudflare rate-limits this API by IP: ~150 requests in a minute at
 * concurrency 3 turned every answer into `429 cf-mitigated: challenge` for the
 * rest of the session (measured 2026-10-10). So everything here is SERIAL with
 * a pause between calls, the detail pass is small, and three refusals in a row
 * end the run with what it has rather than digging the hole deeper.
 */
const DELAY_MS = Number(process.env.MAVI_DELAY_MS ?? 900);

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let strikes = 0;
  const call = async <T = any>(path: string): Promise<T | null> => {
    if (strikes >= 3) return null;
    await sleep(DELAY_MS);
    const d = await api<T>(path);
    strikes = d ? 0 : strikes + 1;
    return d;
  };
  const perSection = Math.ceil(MAX_PRODUCTS / 2); // Çocuk is small; Kadın and Erkek share the rest
  for (const { cat, gender } of SECTIONS) {
    let n = 0;
    for (let page = 0; page < MAX_PAGES && n < perSection && byId.size < MAX_PRODUCTS; page++) {
      const d = await call(
        `/products/search?query=:sale:allCategories:${cat}&pageSize=${PAGE_SIZE}&currentPage=${page}&fields=FULL`,
      );
      if (!d) break;
      const list: any[] = d.products ?? [];
      let discounted = 0;
      for (const p of list) {
        const rec = mapProduct(p, gender);
        if (!rec || rec.listPrice == null) continue;
        discounted++;
        if (!byId.has(rec.externalId) && n < perSection) { byId.set(rec.externalId, rec); n++; }
      }
      // Sorted by discount rate: the first page without one ends the section.
      if (discounted === 0 || page + 1 >= Number(d.pagination?.totalPages ?? 0)) break;
    }
  }
  const records = [...byId.values()].slice(0, MAX_PRODUCTS);

  const pick = [...records];
  for (let j = pick.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [pick[j], pick[k]] = [pick[k], pick[j]];
  }
  for (const r of pick.slice(0, DETAIL_LIMIT)) {
    if (strikes >= 3) break;
    const v = parseVariants(await call(`/products/${encodeURIComponent(r.externalId)}?fields=FULL`));
    if (!v) continue;
    r.variants = v;
    r.inStock = v.sizes.some((s) => s.availability !== "out_of_stock");
  }
  return records;
}
