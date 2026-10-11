/**
 * FLO group storefronts on the in-house "Ftech" platform — FLO, In Street,
 * Lumberjack, Kinetix, Reebok TR (2026-10-11).
 *
 * The web pages are server-rendered HTML (~1.2 MB per 24 products), but the
 * group's Android app (com.flo.ayakkabi, Retrofit `FloApi`) reads the same
 * listings as JSON from the storefront host itself:
 *
 *   https://www.flo.com.tr/webservice/v1/list.json?uri=indirim&page=N
 *
 * `uri` is any listing path of the site, filters ride as the same query keys
 * the site uses (`satici=flo`, `cinsiyet=kadin`), `sort` takes the site's sort
 * keys. No key, no cookie, no app header needed; ~18 KB gzipped per page.
 * Every host answered a GitHub runner with 200 (probe run 38134452967) — the
 * "wall" the home-page probe flagged is only a reCAPTCHA script tag.
 *
 * Page size is fixed (24 on FLO/Reebok, 20 elsewhere). The sale is the
 * `indirim` listing on every site. On FLO that listing is the whole
 * marketplace (162k rows, mostly third-party sellers with permanent "%50"
 * prices), so FLO is filtered to its own stock (`satici=flo`, ~900 rows). A
 * discount is `oldPrice > price`; `ruleInfo` basket offers ("1.200 TL üzeri
 * %25") are conditional and NOT counted. Per-size stock (`options[]`, with a
 * quantity) is in every row, so restock alerts need no PDP call.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export type FtechSlug = "flo" | "instreet" | "lumberjack" | "kinetix" | "reebok";

export interface FtechShop {
  site: string;
  /** Listing path + filters walked for the sale. */
  saleQuery: string;
  /** Prefix product names with the brand (multi-brand shops). */
  multiBrand: boolean;
}

export const FTECH_SHOPS: Record<FtechSlug, FtechShop> = {
  flo: { site: "https://www.flo.com.tr", saleQuery: "uri=indirim&satici=flo&sort=last_order_count:desc", multiBrand: true },
  instreet: { site: "https://www.instreet.com.tr", saleQuery: "uri=indirim&sort=last_order_count:desc", multiBrand: true },
  lumberjack: { site: "https://www.lumberjack.com.tr", saleQuery: "uri=indirim", multiBrand: false },
  kinetix: { site: "https://www.kinetix.com.tr", saleQuery: "uri=indirim", multiBrand: false },
  reebok: { site: "https://www.reebok.com.tr", saleQuery: "uri=indirim", multiBrand: false },
};

const CAP = Number(process.env.FTECH_MAX_PRODUCTS ?? 1500);
const MAX_PAGES = Number(process.env.FTECH_MAX_PAGES ?? 60);
const PAUSE_MS = Number(process.env.FTECH_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g")
    .replace(/[Üü]/g, "u").replace(/[Öö]/g, "o").toLowerCase();

/** Section from the product name ("… Kız Çocuk Bot", "… Kadın Sneaker"); unisex = null. */
export function ftechGender(name: string): ProductRecord["gender"] {
  const t = fold(name);
  if (/\b(cocuk|bebek|kids?|junior)\b/.test(t)) return "cocuk";
  if (/\bkadin\b/.test(t)) return "kadin";
  if (/\berkek\b/.test(t)) return "erkek";
  return null;
}

/** Per-size stock from a row's `options[]`. A quantity of 1–2 is low stock. */
export function ftechSizes(p: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const o of p?.options ?? []) {
    const label = String(o?.option_value ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const qty = Number(o?.qty);
    const availability: SizeVariant["availability"] = !o?.is_in_stock
      ? "out_of_stock"
      : Number.isFinite(qty) && qty > 0 && qty <= 2 ? "low_on_stock" : "in_stock";
    out.push({ label, availability });
  }
  return out;
}

/** Map one `list.json` product. Pure. Prices are major-unit TRY numbers. */
export function mapFtech(slug: FtechSlug, p: any): ProductRecord | null {
  const shop = FTECH_SHOPS[slug];
  const price = Number(p?.price);
  const old = Number(p?.oldPrice);
  if (!p?.sku || !p?.name || !p?.relativeUrl || !Number.isFinite(price) || price <= 0) return null;
  const sizes = ftechSizes(p);
  const brandName = String(p.brandName ?? "").trim();
  const rawName = String(p.name).trim();
  const name = shop.multiBrand && brandName && !fold(rawName).startsWith(fold(brandName)) ? `${brandName} ${rawName}` : rawName;
  const imgs: string[] = (p.images ?? []).filter((u: unknown) => typeof u === "string");
  const first = typeof p.imageUrl === "string" && p.imageUrl ? p.imageUrl : imgs[0] ?? null;
  const colours: any[] = Array.isArray(p.colorOptions) ? p.colorOptions : [];
  const own = colours.find((c) => String(c?.sku) === String(p.sku));
  const siblings = colours.map((c) => String(c?.sku ?? "")).filter(Boolean).sort();
  const crumbs: any[] = Array.isArray(p.breadcrumb) ? p.breadcrumb : [];
  const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : p.isInStock !== false;
  return {
    brand: slug,
    country: "TR",
    externalId: String(p.sku),
    name,
    url: `${shop.site}${p.relativeUrl}`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(price),
    listPrice: Number.isFinite(old) && old > price ? toMinor(old) : null,
    currency: "TRY",
    inStock,
    category: crumbs.length ? String(crumbs[crumbs.length - 1]?.name ?? "") || null : null,
    gender: ftechGender(rawName),
    variants: sizes.length ? { colors: own?.option_title ? [String(own.option_title)] : [], sizes } : null,
    // colorOptions is the shop's own list of this model's colourways.
    groupKey: siblings.length > 1 ? `${slug}:${siblings[0]}` : null,
    colorName: own?.option_title ? String(own.option_title) : null,
  };
}

export function ftechListUrl(slug: FtechSlug, page: number): string {
  const shop = FTECH_SHOPS[slug];
  return `${shop.site}/webservice/v1/list.json?${shop.saleQuery}&page=${page}`;
}

export async function listFtech(slug: FtechSlug, country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR" || !FTECH_SHOPS[slug]) return [];
  const byId = new Map<string, ProductRecord>();
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES) && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(ftechListUrl(slug, page), { retries: 2 }).catch(() => null);
    if (!data || !Array.isArray(data.products)) {
      if (page === 1) throw new Error(`${slug}: list.json refused`);
      break;
    }
    totalPages = Number(data.pagination?.totalPages ?? 1) || 1;
    if (data.products.length === 0) break;
    for (const p of data.products) {
      const r = mapFtech(slug, p);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
