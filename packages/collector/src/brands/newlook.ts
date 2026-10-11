/**
 * New Look (United Kingdom) — SAP Commerce (hybris) storefront with an
 * AngularJS front end, behind PerimeterX.
 *
 * PerimeterX challenges browser user agents (403 "Please verify you are
 * human") but lets a non-browser client through: with an `okhttp/…` UA the
 * pages and the PLP's own JSON endpoint answer 200 (probe 2026-10-11, no
 * proxy). The JSON endpoint is what the grid's "load more" calls
 * (searchService.categorySearch in common.min.js):
 *
 *   /uk/<category path>/c/<code>/data-48.json?q=:relevance&page=N&sort=relevance&language=en&currency=GBP
 *
 * 48 products per page (the size in the path is ignored), each with price,
 * previousPrice, stock and per-size `sizeOptions[].stockStatus` — real size
 * restock data. The Sale categories hold ~5.6k (women), so pages are budgeted
 * per department to stay near the cap and the request limit.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "newlook";

const SITE = "https://www.newlook.com";
const CAP = 1500;
const PAUSE_MS = 700;
/** PerimeterX lets non-browser clients through and challenges browser UAs. */
const HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sale departments: category path, section gender, page budget (48 rows each). */
export const DEPARTMENTS: [path: string, gender: ProductRecord["gender"], pages: number][] = [
  ["/uk/womens/womens-sale/c/uk-womens-sale", "kadin", 24],
  ["/uk/mens/sale/c/uk-mens-sale", "erkek", 5],
  ["/uk/girls/sale/c/uk-teens-sale", "cocuk", 3],
];

export const pageUrl = (path: string, page: number) =>
  `${SITE}${path}/data-48.json?q=%3Arelevance&page=${page}&sort=relevance&language=en&currency=GBP`;

/** Older responses serialised nested fields as JSON strings; accept both. */
const obj = (v: unknown): any => {
  if (typeof v !== "string") return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

const abs = (u: unknown) => (typeof u === "string" && u ? (u.startsWith("//") ? `https:${u}` : u) : null);

function availability(s: unknown): SizeVariant["availability"] {
  const v = String(s ?? "").toUpperCase();
  if (v === "AVAILABLE" || v === "INSTOCK" || v === "IN_STOCK") return "in_stock";
  if (v.includes("LOW")) return "low_on_stock";
  return "out_of_stock";
}

/** Map one search result. Pure; null unless it is marked down. */
export function mapNewLook(r: any, gender: ProductRecord["gender"], country: CountryCode = "GB"): ProductRecord | null {
  const price = Number(obj(r?.price)?.value);
  const prev = obj(r?.previousPrice);
  const was = Number(prev?.value);
  if (!r?.code || !r?.name || !(price > 0) || !(was > price)) return null;
  const cur = obj(r.price)?.currencyIso;
  if (cur && cur !== "GBP") return null;
  const sizes: SizeVariant[] = (obj(r.sizeOptions) ?? [])
    .filter((s: any) => s?.value)
    .map((s: any) => ({ label: String(s.value).replace(/^UK\s+/i, ""), availability: availability(s.stockStatus) }));
  const stock = obj(r.stock)?.stockLevelStatus?.code;
  const gallery: string[] = (obj(r.gallery) ?? []).filter((g: any) => !g?.video).map((g: any) => abs(g?.url));
  const first = abs(obj(r.primaryImage)?.url) ?? gallery[0] ?? abs(obj(r.images)?.[0]?.url);
  const sized = (u: string | null) => (u ? `${u}?strip=true&qlt=80&w=720` : null);
  const dept = String(r.departmentCode ?? "").toLowerCase();
  const path = String(r.url ?? "").split("/").filter(Boolean);
  return {
    brand,
    country,
    externalId: String(r.code),
    name: String(r.name).trim(),
    url: `${SITE}/uk${r.url}`,
    imageUrl: sized(first),
    images: cleanGallery(gallery.map(sized), sized(first)),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: "GBP",
    inStock: stock ? !/outofstock|out_of_stock/i.test(stock) : sizes.some((s) => s.availability !== "out_of_stock"),
    // /womens/clothing/tops/<slug>/p/<code> → "tops"
    category: path.length >= 4 ? path[path.length - 4] : null,
    gender: dept === "mens" ? "erkek" : dept === "womens" ? "kadin" : /teen|girl|kid/.test(dept) ? "cocuk" : gender,
    variants: sizes.length ? { colors: [], sizes } : null,
  };
}

export async function listProducts(country: CountryCode = "GB"): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  for (const [path, gender, budget] of DEPARTMENTS) {
    for (let page = 0; page < budget; page++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const d = await getJson<any>(pageUrl(path, page), { country, headers: HEADERS }).catch((e) => {
        if (requests === 1) throw e;
        return null;
      });
      const data = d?.data ?? d;
      const rows: any[] = data?.results ?? [];
      for (const r of rows) {
        const rec = mapNewLook(r, gender, country);
        if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
      }
      if (!rows.length || page + 1 >= Number(data?.pagination?.numberOfPages ?? 0)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
