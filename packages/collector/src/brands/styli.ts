/**
 * Styli (stylishop.com) — Landmark-backed Gulf fast-fashion marketplace, UAE
 * and KSA. Measured 2026-10-11:
 *
 * - stylishop.com, prod-api.stylishop.com and bucket.stylishop.com all sit
 *   behind a Cloudflare challenge. The product lists, though, come from the
 *   "visual merchandising" listing service `vm-prod.stylishop.com`, which has
 *   no wall: a plain JSON POST answers (found in the app's Flutter binary;
 *   body shape from the web bundle's listing call, `m.stylishop.com/static/js/
 *   main.*.chunk.js`, served unwalled from the GCS bucket).
 * - `storeId` picks market + language: 7 = UAE English (AED), 1 = KSA English
 *   (SAR). `numericFilters: discount_percentage >= 1` is the site's own
 *   discount filter (~78k rows in AE).
 * - `pageSize` is capped at 100 server-side, so 1,500 rows is 15 requests of
 *   ~0.8 MB (most of it the facet tree, which cannot be switched off).
 * - Per size: `configProducts[].warehouseData[].data[].qty` — summed, it is the
 *   size's stock, which is what powers size-restock alerts.
 * - `prices.specialPrice` is the shelf price, `prices.price` the original;
 *   `bestPrice` is after an app coupon and is ignored, like basket promos
 *   elsewhere.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const ENDPOINT = "https://vm-prod.stylishop.com/api/v2/listing/vm";
const STORE: Partial<Record<CountryCode, number>> = { AE: 7, SA: 1 };
const PAGE_SIZE = 100;
const CAP = Number(process.env.STYLI_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Math.ceil(CAP / PAGE_SIZE) + 2;

function genderOf(p: any): ProductRecord["gender"] {
  const g = String(p?.gender ?? "").toLowerCase();
  const top = String(p?.categories?.level0?.[0] ?? "").toLowerCase();
  if (/^(boys?|girls?|kids?|baby|infant)/.test(g) || top === "kids") return "cocuk";
  if (g === "women" || top === "women") return "kadin";
  if (g === "men" || top === "men") return "erkek";
  return null;
}

function sizesOf(p: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const c of p?.configProducts ?? []) {
    const label = String(c?.size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    let qty = 0;
    for (const w of c?.warehouseData ?? []) for (const d of w?.data ?? []) qty += Number(d?.qty ?? 0) || 0;
    out.push({ label, availability: qty <= 0 ? "out_of_stock" : qty <= 2 ? "low_on_stock" : "in_stock" });
  }
  return out;
}

/** Map one listing product. Pure. Returns null when it has no usable price. */
export function mapStyli(country: CountryCode, p: any): ProductRecord | null {
  const price = Number(p?.prices?.specialPrice || p?.prices?.price);
  const orig = Number(p?.prices?.price);
  if (!p?.sku || !p?.name || typeof p?.url !== "string" || !(price > 0)) return null;
  const brand = String(p.brand ?? "").trim();
  const title = String(p.name).replace(/\s+/g, " ").trim();
  const name = brand && !title.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${title}` : title;
  const gallery: string[] = (p.convertedMediaGallery ?? p.images?.mediaGallery ?? []).filter((u: unknown) => typeof u === "string");
  const first = typeof p.images?.image === "string" ? p.images.image : gallery[0] ?? null;
  const sizes = sizesOf(p);
  const color = typeof p.color === "string" && p.color.trim() ? p.color.trim() : null;
  const leaf = String(p.categories?.level3?.[0] ?? p.categories?.level2?.[0] ?? "").split("///").pop()?.trim() ?? "";
  const style = String(p.styliId ?? "").trim();
  return {
    brand: "styli",
    country,
    externalId: String(p.sku),
    name,
    url: p.url,
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(price),
    listPrice: orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: Number(p.inStock ?? 1) === 1 && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: leaf || null,
    gender: genderOf(p),
    variants: sizes.length || color ? { colors: color ? [color] : [], sizes } : null,
    groupKey: style && style !== String(p.sku) ? `styli:${style}` : null,
    colorName: color,
  };
}

export function styliBody(country: CountryCode, page: number): string {
  return JSON.stringify({
    query: "",
    filters: {},
    numericFilters: [{ type: "discount_percentage", value: 1, operator: "GREATER_THAN_AND_EQUALS" }],
    pageOffset: page,
    pageSize: PAGE_SIZE,
    storeId: STORE[country],
    code: 1,
  });
}

export async function listStyli(country: CountryCode): Promise<ProductRecord[]> {
  if (!STORE[country]) return [];
  const cur = COUNTRIES[country].currency;
  const byId = new Map<string, ProductRecord>();
  for (let page = 0; page < MAX_PAGES && byId.size < CAP; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 600));
    const data = await getJson<any>(ENDPOINT, {
      method: "POST",
      body: styliBody(country, page),
      country,
      headers: { "Content-Type": "application/json" },
    });
    const res = data?.response ?? data;
    const rows: any[] = res?.products ?? [];
    for (const p of rows) {
      if (p?.currency && p.currency !== cur) continue;
      const r = mapStyli(country, p);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < PAGE_SIZE || page + 1 >= Number(res?.totalPages ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
