/**
 * Lulus (lulus.com) — US women's fashion, a Nuxt storefront behind
 * PerimeterX. The category grid is filled client-side from the site's own
 * JSON API, `/api/search/products/<categoryId>?pp=<n>&p=<page>`, which
 * answers a plain request as long as it asks for JSON (`Accept:
 * application/json`; without it PerimeterX serves its captcha page).
 *
 * The feed is the "Sale" category (id 95, ~2,080 products, 2026-10-21). Each
 * product carries one swatch with `productPrice` — `price` (the regular price
 * the site strikes through) and `salePrice` — and per-size stock
 * (`quantityType` InStock / LowStock / OutOfStock). `promoPrice` is a
 * coupon-code price ("with code FALLFAVES") and is ignored: only the store's
 * own reduced price counts.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.lulus.com";
const SALE_CATEGORY = 95;
const PER_PAGE = 250;
const MAX_PAGES = 12;
const CAP = 1500;
const PAUSE_MS = Number(process.env.LULUS_PAUSE_MS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const availability = (q: unknown): SizeVariant["availability"] =>
  q === "InStock" ? "in_stock" : q === "LowStock" ? "low_on_stock" : "out_of_stock";

/** One `/api/search/products` product → a record, or null without a real markdown. Pure. */
export function mapLulus(p: any, country: CountryCode = "US"): ProductRecord | null {
  const sw = (p?.swatches ?? []).find((s: any) => s?.selected) ?? p?.swatches?.[0];
  const pp = sw?.productPrice;
  const price = Number(pp?.salePrice);
  const was = Number(pp?.price);
  const name = typeof sw?.name === "string" ? sw.name.replace(/\s+/g, " ").trim() : "";
  if (!sw?.id || !name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) return null;
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const s of sw.sizes ?? []) {
    const label = String(s?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: availability(s.quantityType) });
  }
  const photos: string[] = (sw.images ?? [])
    .map((im: any) => (typeof im?.imagePath === "string" ? `${ORIGIN}${im.imagePath}` : null))
    .filter((u: string | null): u is string => !!u);
  const images = cleanGallery(photos);
  const colour = typeof sw.colorName === "string" ? sw.colorName.trim() : "";
  return {
    brand: "lulus",
    country,
    externalId: String(sw.id),
    name,
    url: `${ORIGIN}/products/${sw.id}`,
    imageUrl: images?.[0] ?? null,
    images,
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : sw.quantityType !== "OutOfStock",
    category: null,
    gender: "kadin",
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: p.groupId ? `lulus:${p.groupId}` : null,
    colorName: colour || null,
  };
}

/** Register as `listLulus(country)`. US only (Canada is the same USD feed converted by Global-e). */
export async function listLulus(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES && seen < total; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(`${ORIGIN}/api/search/products/${SALE_CATEGORY}?pp=${PER_PAGE}&p=${page}`, {
      country,
      headers: { Accept: "application/json" },
    });
    const products: any[] = data?.content?.products;
    if (!data?.success || !Array.isArray(products)) throw new Error(`lulus/${country}: page ${page} returned no product list`);
    total = Number(data.content.total) || 0;
    seen += products.length;
    for (const p of products) {
      const r = mapLulus(p, country);
      if (r) byId.set(r.externalId, r);
    }
    if (products.length < PER_PAGE) break;
    if (page === MAX_PAGES && seen < total) throw new Error(`lulus/${country}: ${total} sale products exceed ${MAX_PAGES} pages`);
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
