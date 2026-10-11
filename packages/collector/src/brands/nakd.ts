/**
 * NA-KD Norway, outlet only (2026-10-11). na-kd.com is an Avensia Nitro shop:
 * a page answers its own URL with the page view-model as JSON when the request
 * carries `X-Requested-With: XMLHttpRequest` — what the site's own client sends
 * on navigation. No key, no cookie, no proxy.
 *
 * Paging, measured: `?skip=S&count=E` returns rows S..E-1 (E is the END index,
 * not a page size) — as a bare product array once S > 0, and as the full page
 * model when S = 0. An empty window answers 404. `/no/outlet` holds ~2,200
 * colourways, so 300 a call is ~8 requests for the whole outlet.
 *
 * Each card carries every size with `price.current` / `price.original` (NOK
 * major units) and `stock` high|low|none — per-size availability for restock
 * alerts, no per-product call. NA-KD is a women's label.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "na-kd";
const ORIGIN = "https://www.na-kd.com";
export const NAKD_MARKETS: Partial<Record<CountryCode, { path: string }>> = {
  NO: { path: "/no/outlet" },
};

const WINDOW = 300;
const MAX_REQUESTS = Number(process.env.NAKD_MAX_REQUESTS ?? 15);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const val = (x: any): string | null => (x == null ? null : typeof x === "object" ? (x.$c ?? null) : String(x));

const STOCK: Record<string, SizeVariant["availability"]> = { high: "in_stock", low: "low_on_stock", none: "out_of_stock" };

export function mapNakd(p: any, country: CountryCode = "NO"): ProductRecord | null {
  const code = val(p?.variation?.code);
  const name = val(p?.variation?.displayName);
  if (!code || !name || !p?.url || p?.isGiftCard) return null;
  const sizes: any[] = Array.isArray(p.sizes) ? p.sizes : [];
  const priced = sizes
    .map((s) => ({ cur: Number(s?.price?.current), orig: Number(s?.price?.original) }))
    .filter((x) => x.cur > 0);
  if (!priced.length) return null;
  const pick = [...priced].sort((a, b) => a.cur - b.cur)[0];
  const variants: SizeVariant[] = sizes
    .filter((s) => s?.sizeName)
    .map((s) => ({ label: String(s.sizeName).trim(), availability: STOCK[String(s.stock)] ?? "out_of_stock" }));
  const colour = val(p.variation.itemColorName);
  const imgs: string[] = (p.imageUrls ?? []).filter((u: unknown) => typeof u === "string");
  const siblings = Array.isArray(p.productSiblingLinks) ? p.productSiblingLinks.length : 0;
  const base = code.replace(/-[^-]+$/, "");
  return {
    brand,
    country,
    externalId: code,
    name: name.trim(),
    url: `${ORIGIN}${p.url}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(pick.cur),
    listPrice: pick.orig > pick.cur ? toMinor(pick.orig) : null,
    currency: COUNTRIES[country].currency,
    inStock: !p.isSoldOut && variants.some((v) => v.availability !== "out_of_stock"),
    category: p.mainCategory ? String(p.mainCategory) : null,
    gender: "kadin",
    variants: variants.length ? { colors: colour ? [colour] : [], sizes: variants } : null,
    groupKey: siblings > 1 && base !== code ? `${brand}:${base}` : null,
    colorName: colour,
  };
}

export function windowUrl(country: CountryCode, skip: number): string {
  return `${ORIGIN}${NAKD_MARKETS[country]!.path}?skip=${skip}&count=${skip + WINDOW}`;
}

export async function listNakd(country: CountryCode = "NO"): Promise<ProductRecord[]> {
  if (!NAKD_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  let total = Infinity;
  for (let i = 0; i < MAX_REQUESTS && i * WINDOW < total; i++) {
    if (i > 0) await sleep(800);
    let data: any;
    try {
      data = await getJson<any>(windowUrl(country, i * WINDOW), {
        country,
        retries: i === 0 ? 2 : 1,
        headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json" },
      });
    } catch (err) {
      if (i === 0) throw err;
      break; // an empty window is a 404
    }
    const rows: any[] = Array.isArray(data) ? data : (data?.products?.products ?? []);
    if (!Array.isArray(data) && data?.products?.totalProductCount) total = Number(data.products.totalProductCount);
    if (!rows.length) break;
    for (const p of rows) {
      const r = mapNakd(p, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (rows.length < WINDOW) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listNakd;
