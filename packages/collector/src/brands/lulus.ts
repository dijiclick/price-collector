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
 *
 * PerimeterX lets a runner IP make only a handful of these calls before it
 * answers 403 (probe 39685263884, 2026-10-21: six 400-product pages 200, the
 * seventh 403), so pages are as large as the API serves (`pp` is capped at
 * 400: ~2,080 sale products in 6 calls instead of 9 at 250), and a refused page
 * is asked again after a longer pause.
 *
 * By 2026-10-24 the budget had shrunk to five: four runs in a row got pages 1-5
 * and a 403 on page 6 (the last one) that the 10 s / 30 s retries did not clear.
 * So the walk stops as soon as it holds CAP in-stock deals (the capped result
 * keeps the same rows a full walk would: later pages only add rows behind the
 * cut), and a page refused after the first no longer throws away the pages
 * already read when they make a full feed (CAP deals, or 90% of the category).
 * The cap already leaves ~500 sale products out of every run, so the missing
 * tail is swept the same way. Anything thinner still fails the run.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.lulus.com";
const SALE_CATEGORY = 95;
/** The API's maximum (`pp=1000` returns 400). */
const PER_PAGE = 400;
const MAX_PAGES = 8;
const CAP = 1500;
const PAUSE_MS = Number(process.env.LULUS_PAUSE_MS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page; a PerimeterX 403 is asked again after 10 s and 30 s (scaled by LULUS_PAUSE_MS). */
async function getPage(url: string, country: CountryCode): Promise<any> {
  const waits = [0, 10_000, 30_000].map((ms) => (ms * PAUSE_MS) / 1500);
  let last: unknown;
  for (const wait of waits) {
    if (wait) await sleep(wait);
    try {
      return await getJson<any>(url, { country, retries: 0, headers: { Accept: "application/json" } });
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

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
  let inStock = 0;
  for (let page = 1; page <= MAX_PAGES && seen < total && inStock < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    let data: any;
    try {
      data = await getPage(`${ORIGIN}/api/search/products/${SALE_CATEGORY}?pp=${PER_PAGE}&p=${page}`, country);
    } catch (err) {
      // PerimeterX's per-IP budget ran out mid-walk. Keep what was read only
      // when it is a full feed; otherwise fail as before.
      if (page > 1 && (byId.size >= CAP || seen >= total * 0.9)) {
        console.log(`lulus/${country}: page ${page} refused (${(err as Error).message}); keeping ${byId.size} deals from ${seen}/${total} products`);
        break;
      }
      throw err;
    }
    const products: any[] = data?.content?.products;
    if (!data?.success || !Array.isArray(products)) throw new Error(`lulus/${country}: page ${page} returned no product list`);
    total = Number(data.content.total) || 0;
    seen += products.length;
    for (const p of products) {
      const r = mapLulus(p, country);
      if (!r) continue;
      inStock += Number(r.inStock) - Number(byId.get(r.externalId)?.inStock ?? false);
      byId.set(r.externalId, r);
    }
    if (products.length < PER_PAGE) break;
    if (page === MAX_PAGES && seen < total && inStock < CAP) throw new Error(`lulus/${country}: ${total} sale products exceed ${MAX_PAGES} pages`);
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
