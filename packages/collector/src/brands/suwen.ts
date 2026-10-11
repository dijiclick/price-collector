/**
 * Suwen (suwen.com.tr) — Inveon's newer Next.js storefront (2026-10-11).
 *
 * The outlet page `/c/outlet-indirimleri` is server-rendered with its search
 * request in `__NEXT_DATA__` (`props.pageProps.data.request`: product-type
 * aggregation filter, sort, the field `includes`), and the grid pages through
 * the storefront's own route with that same body:
 *
 *   POST /api/search-products   { ...request, pageSize, currentPage }
 *
 * Reading the request from the page (one extra call) keeps the outlet's type id
 * out of this file. Adding `Barcodes.*` to `includes` returns each barcode's
 * size (`stockTypeValues[].name`) and EAN beside `stocksByBarcode`, so per-size
 * stock and barcodes come with the listing. No proxy: the GitHub-runner probe
 * reached the home page and the route answers plain requests.
 *
 * PRICES (gross TRY): `basePrice` is the strikethrough, `salesPrice` the
 * charged price (`discountPrice` equals it on every row seen).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson, getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "suwen";
export const SITE = "https://www.suwen.com.tr";
const CDN = "https://suwen.mncdn.com";
const OUTLET_PATH = "/c/outlet-indirimleri";
const PAGE_SIZE = 100;
const MAX_PRODUCTS = Number(process.env.SUWEN_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Number(process.env.SUWEN_MAX_PAGES ?? 25);
const PAUSE_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const EXTRA_INCLUDES = [
  "Barcodes",
  "Barcodes.Id",
  "Barcodes.Barcode",
  "Barcodes.StockTypeValues",
  "Barcodes.StockTypeValues.Name",
  "Barcodes.StockTypeValues.Order",
];

const attr = (p: any, re: RegExp): string | null => {
  const a = (p?.attributes ?? []).find((x: any) => re.test(String(x?.attribute?.name ?? "")));
  const v = a?.attributeValues?.[0]?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

export function genderOf(p: any): ProductRecord["gender"] {
  const t = fold(`${attr(p, /^cinsiyet$/i) ?? ""} ${p?.name ?? ""}`);
  if (/cocuk|kiz|bebek|genc/.test(t)) return "cocuk";
  if (/erkek/.test(t)) return "erkek";
  // A women's lingerie/homewear brand; rows without a section are women's.
  return "kadin";
}

/** Sizes from the listing's barcodes + `stocksByBarcode`. Pure. */
export function sizesOf(p: any): SizeVariant[] {
  const stock: Record<string, number> = p?.stocksByBarcode ?? {};
  const rows = (p?.barcodes ?? [])
    .map((b: any) => ({ id: String(b?.id), v: b?.stockTypeValues?.[0] }))
    .filter((x: any) => x.v?.name)
    .sort((a: any, b: any) => (a.v.order ?? 0) - (b.v.order ?? 0));
  const seen = new Set<string>();
  const out: SizeVariant[] = [];
  for (const { id, v } of rows) {
    const label = String(v.name).trim();
    if (seen.has(label)) continue;
    seen.add(label);
    const q = Number(stock[id] ?? 0);
    out.push({ label, availability: q > 1 ? "in_stock" : q === 1 ? "low_on_stock" : "out_of_stock" });
  }
  if (out.length === 1 && /^(std|standart|tek beden|tek ebat)$/i.test(out[0].label)) return [];
  return out;
}

/** Map one search hit. Pure. */
export function mapSuwen(p: any): ProductRecord | null {
  const now = Number(p?.salesPrice ?? p?.discountPrice);
  const was = Number(p?.basePrice);
  if (!p?.id || !p?.name || !p?.routePath || !Number.isFinite(now) || now <= 0) return null;
  const imgs = [...(p.documents ?? [])]
    .filter((d: any) => d?.documentType === "Image" && typeof d?.filePath === "string")
    .sort((a: any, b: any) => Number(b.isDefault) - Number(a.isDefault) || (a.order ?? 0) - (b.order ?? 0))
    .map((d: any) => `${CDN}/${String(d.filePath).replace(/^\/+/, "")}`);
  const sizes = sizesOf(p);
  const stock: Record<string, number> = p.stocksByBarcode ?? {};
  const colour = attr(p, /^renk - detay$/i) ?? attr(p, /^renk$/i);
  const eans = (p.barcodes ?? []).map((b: any) => b?.barcode).filter((b: unknown): b is string => typeof b === "string" && /^\d{8,14}$/.test(b));
  const defCat = (p.categories ?? []).find((c: any) => c?.isDefault)?.name;
  return {
    brand,
    country: "TR",
    externalId: String(p.code || p.sku || p.id),
    name: String(p.name).trim(),
    url: `${SITE}/p/${p.routePath}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(now),
    listPrice: Number.isFinite(was) && was - now > 0.005 ? toMinor(was) : null,
    currency: "TRY",
    inStock: Object.values(stock).some((q) => Number(q) > 0),
    barcodes: eans.length ? eans : null,
    category: attr(p, /^ürün cinsi$/i) ?? defCat ?? null,
    gender: genderOf(p),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: p.hsCode ? `suwen:${p.hsCode}` : null,
    colorName: colour,
  };
}

/** The outlet page's own search request, from its `__NEXT_DATA__`. */
export function requestFromHtml(html: string): Record<string, any> | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const req = JSON.parse(m[1])?.props?.pageProps?.data?.request;
    return req && typeof req === "object" ? req : null;
  } catch {
    return null;
  }
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const req = requestFromHtml(await getText(`${SITE}${OUTLET_PATH}`));
  if (!req) throw new Error("suwen: outlet page carried no search request");
  const includes = [...new Set([...(req.includes ?? []), ...EXTRA_INCLUDES])];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    await sleep(PAUSE_MS);
    const j = await getJson<any>(`${SITE}/api/search-products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, includes, pageSize: PAGE_SIZE, currentPage: page }),
      retries: 1,
    }).catch((e) => {
      if (page === 1) throw e;
      return null;
    });
    const rows: any[] = j?.products ?? [];
    for (const p of rows) {
      const r = mapSuwen(p);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
    if (!rows.length || page >= Number(j?.totalPages ?? 0)) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, MAX_PRODUCTS);
}
