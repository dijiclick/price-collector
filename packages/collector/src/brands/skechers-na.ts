/**
 * Skechers North America — skechers.com (US) and skechers.ca (CA), through the
 * Bloomreach Discovery index the storefront itself searches with.
 *
 * NOT the Turkish Skechers (skechers.com.tr, PersonaClick feed — `skechers.ts`):
 * the US/CA sites are Salesforce Commerce Cloud (`Sites-USSkechers-Site`,
 * `Sites-CASkechers-Site`) with no `/products.json` (410 on a runner). The page
 * config carries the public Bloomreach account (`account_id=7927`) and catalog
 * views (`skechers_na`, `skechers_na_en_ca`); `core.dxpapi.com` answers a plain
 * GET from a GitHub runner (probe run 38228747327, 2026-10-12: US 656 / CA 803
 * sale rows).
 *
 * - `fq=onSale:"Sale"` is the site's Sale section; `fq=Style:[* TO *]` keeps
 *   footwear (apparel, watches and bags carry no Style). The Style facet is the
 *   shoe type, so the sale is fetched one style at a time to label each row
 *   (~20 requests per market).
 * - A doc is one style (master); its doc-level `price`/`sale_price` often both
 *   read full price. The one variant Bloomreach returns is a SKU that matched
 *   `onSale` — its `sku_price` (struck through) / `sku_sale_price` and its
 *   colour are the deal, so a row is that colour of that style.
 * - The index carries offered sizes, not stock (a size the PDP shows as
 *   unselectable is still listed), so no per-size stock and every row counts as
 *   in stock. `skuid` is the SKU's UPC.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "skechers";

export const SKECHERS_NA_MARKETS: Partial<Record<CountryCode, { host: string; domain: string; salePath: string }>> = {
  US: { host: "https://www.skechers.com", domain: "skechers_na", salePath: "/sale/" },
  CA: { host: "https://www.skechers.ca", domain: "skechers_na_en_ca", salePath: "/en/sale/" },
};

const API = "https://core.dxpapi.com/api/v1/core/";
const ACCOUNT = "7927";
const FL = [
  "pid", "title", "price", "sale_price", "url", "thumb_image", "gender", "colors", "colorCode",
  "sku_size", "sku_color", "sku_price", "sku_sale_price", "skuid", "sku_thumb_images",
].join(",");
const ROWS = 200;
const MAX_REQUESTS = 50;
const CAP = Number(process.env.SKECHERS_NA_MAX_PRODUCTS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Bloomreach search URL over the market's sale footwear (plus extra filters). */
export function skechersNaUrl(country: CountryCode, opts: { style?: string; start?: number; rows?: number } = {}): string | null {
  const m = SKECHERS_NA_MARKETS[country];
  if (!m) return null;
  const p = new URLSearchParams({
    account_id: ACCOUNT,
    domain_key: m.domain,
    request_type: "search",
    search_type: "keyword",
    q: "*",
    rows: String(opts.rows ?? ROWS),
    start: String(opts.start ?? 0),
    url: `${m.host}${m.salePath}`,
    ref_url: "",
    _br_uid_2: "uid=modadrop",
    fl: FL,
  });
  p.append("fq", 'onSale:"Sale"');
  p.append("fq", opts.style ? `Style:"${opts.style}"` : "Style:[* TO *]");
  return `${API}?${p.toString()}`;
}

const GENDER: Record<string, ProductRecord["gender"]> = { "women's": "kadin", "men's": "erkek", "boys'": "cocuk", "girls'": "cocuk" };
const first = (v: unknown): any => (Array.isArray(v) ? v[0] : v);

/** A Skechers image at a usable width (the index stores `width=auto`). */
const sized = (u: unknown): string | null =>
  typeof u === "string" && /^https?:\/\//.test(u) ? u.replace(/width=auto/, "width=800") : null;

/** One Bloomreach doc → the record for its on-sale colour, or null when no real markdown. Pure. */
export function mapSkechersNaDoc(doc: any, country: CountryCode, style: string | null = null): ProductRecord | null {
  const m = SKECHERS_NA_MARKETS[country];
  if (!m || !doc?.pid || !doc?.title) return null;
  const v = Array.isArray(doc.variants) ? doc.variants[0] : null;
  const price = Number(v?.sku_sale_price ?? doc.sale_price);
  const list = Number(v?.sku_price ?? doc.price);
  if (!(price > 0) || !(list > price)) return null;
  const color = String(first(v?.colorCode) ?? doc.colorCode ?? "").trim();
  const path = String(doc.url ?? "");
  if (!color || !/^\/.+\.html$/.test(path)) return null;
  // The doc url opens the style's default colour; point it at the sale colour.
  const url = `${m.host}${path.replace(/_[A-Z0-9]+\.html$/, `_${color}.html`)}`;
  const img = sized(first(v?.sku_thumb_images)) ?? sized(doc.thumb_image);
  const colorName = v?.sku_color ? String(v.sku_color).replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  const upc = String(v?.skuid ?? "");
  return {
    brand,
    country,
    externalId: `${doc.pid}-${color}`,
    name: String(doc.title).replace(/ /g, " ").replace(/\s+/g, " ").trim(),
    url,
    imageUrl: img,
    images: cleanGallery([img], img),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock: true,
    barcodes: /^\d{12,14}$/.test(upc) ? [upc] : null,
    category: style,
    gender: GENDER[String(doc.gender ?? "").toLowerCase()] ?? null,
    variants: null,
    groupKey: String(doc.pid),
    colorName,
  };
}

/** The Style facet of the market's sale footwear: [value, count][]. Pure. */
export function styleFacet(res: any): [string, number][] {
  const f = (res?.facet_counts?.facets ?? []).find((x: any) => x?.name === "Style");
  return (f?.value ?? []).map((x: any) => [String(x.name), Number(x.count) || 0] as [string, number]).filter(([n]: [string, number]) => n);
}

export async function listSkechersNa(country: CountryCode): Promise<ProductRecord[]> {
  if (!SKECHERS_NA_MARKETS[country]) return [];
  let requests = 0;
  const get = async (url: string) => {
    if (requests++ > 0) await sleep(400);
    return getJson<any>(url, { country });
  };
  const head = await get(skechersNaUrl(country, { rows: 0 })!);
  const styles = styleFacet(head);
  const byId = new Map<string, ProductRecord>();
  for (const [style, count] of styles) {
    for (let start = 0; start < count && requests < MAX_REQUESTS; start += ROWS) {
      const res = await get(skechersNaUrl(country, { style, start })!);
      const docs: any[] = res?.response?.docs ?? [];
      for (const d of docs) {
        const r = mapSkechersNaDoc(d, country, style);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (docs.length < ROWS) break;
    }
  }
  // Anything a style pass missed (none expected) comes from one unlabelled pass.
  const total = Number(head?.response?.numFound ?? 0);
  if (byId.size < total * 0.8) {
    for (let start = 0; start < total && requests < MAX_REQUESTS; start += ROWS) {
      const docs: any[] = (await get(skechersNaUrl(country, { start })!))?.response?.docs ?? [];
      for (const d of docs) {
        const r = mapSkechersNaDoc(d, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (docs.length < ROWS) break;
    }
  }
  if (!byId.size) throw new Error(`skechers ${country}: no discounted footwear in the Bloomreach sale feed`);
  const off = (r: ProductRecord) => (r.listPrice! - r.price) / r.listPrice!;
  return [...byId.values()].sort((a, z) => off(z) - off(a)).slice(0, CAP);
}
