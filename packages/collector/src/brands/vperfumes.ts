/**
 * V Perfumes (vperfumes.com) — UAE fragrance retailer with a KSA store.
 * Storefront paths are /ae-en and /sa-en.
 *
 * Measured 2026-10-11: the Next.js front end's infinite scroll POSTs to
 * `api.vperfumes.com/api/v1/w/product-listing-v2` with the filter body below.
 * The API wants a `Devicetoken` header, which the site itself mints as
 * base64(random + Date.now()) for a guest — any such value is accepted — and
 * a `Store: AE|SA` header that picks the catalogue. `discount: 1` returns only
 * reduced rows (AE ~12k, SA ~3.9k); `limit` 100 is honoured. Each row carries
 * `priceDisplay[aed|sar].{mrp, selling}`; the store's own currency is the
 * native price (SA rows are round SAR, AED is the conversion, and vice versa).
 *
 * Every listing is one bottle size (the volume is in the name), so there are
 * no per-size variants to report.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const API = "https://api.vperfumes.com/api/v1/w/product-listing-v2";
const SITE = "https://www.vperfumes.com";
export const VPERFUMES_MARKETS: Partial<Record<CountryCode, string>> = { AE: "ae-en", SA: "sa-en" };
const PER_PAGE = 100;
const CAP = Number(process.env.VPERFUMES_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Math.ceil(CAP / PER_PAGE) + 1;

export function listingBody(page: number) {
  return {
    page, limit: PER_PAGE, category: [], collection: null, brand: null, note: null, sort: "",
    priceFrom: null, priceTo: null, rating: null, discount: 1, volume: null, gender: [],
    occasion: [], fragranceFamily: [], search: "", sellerId: null, uc_param: "",
  };
}

function genderOf(name: string): ProductRecord["gender"] {
  if (/\bunisex\b/i.test(name)) return null;
  if (/\b(for )?women\b|\bher\b|\bfemme\b/i.test(name)) return "kadin";
  if (/\b(for )?men\b|\bhim\b|\bhomme\b/i.test(name)) return "erkek";
  return null;
}

/** Map one listing row. Pure. */
export function mapVPerfumes(it: any, country: CountryCode): ProductRecord | null {
  const path = VPERFUMES_MARKETS[country];
  const cur = COUNTRIES[country].currency.toLowerCase();
  const p = it?.priceDisplay?.[cur];
  const name = String(it?.name?.text?.en ?? "").replace(/\s+/g, " ").trim();
  const slug = it?.params?.slug;
  const price = Number(p?.selling ?? p?.offer);
  const mrp = Number(p?.mrp);
  if (!path || !it?.sku || !name || !slug || !(price > 0)) return null;
  const imgs: string[] = (it.images ?? []).filter((u: unknown) => typeof u === "string");
  return {
    brand: "vperfumes",
    country,
    externalId: String(it.sku),
    name,
    url: `${SITE}/${path}/product/${slug}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(mrp) && mrp > price ? toMinor(mrp) : null,
    currency: COUNTRIES[country].currency,
    inStock: it.inStock !== false,
    category: it?.category?.text?.en ? String(it.category.text.en) : null,
    gender: genderOf(name),
    variants: null,
  };
}

export const brand = "vperfumes";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  if (!VPERFUMES_MARKETS[country]) return [];
  const token = Buffer.from(`${Math.random().toString(36).slice(2)}${Date.now()}`).toString("base64");
  const headers = {
    "Content-Type": "application/json",
    Devicetoken: token,
    devicetype: "web",
    Store: country,
    lang: "en",
    Origin: SITE,
    Referer: `${SITE}/`,
  };
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, 600));
    const data = await getJson<any>(API, { method: "POST", body: JSON.stringify(listingBody(page)), headers, country });
    if (data?.success === false) throw new Error(`vperfumes/${country}: ${data?.message}`);
    const rows: any[] = data?.result?.products?.product_items ?? [];
    for (const it of rows) {
      const r = mapVPerfumes(it, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < PER_PAGE || data?.result?.products?.last_page) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
