/**
 * Cupshe — US (www.cupshe.com) and Canada (ca.cupshe.com). Added 2026-10-21.
 *
 * Cupshe left Shopify for its own Vue SSR storefront: `/products.json`,
 * `/meta.json` and the Storefront API are gone (404). Each collection page is
 * server-rendered with the whole product grid inlined as JSON
 * (`window.__CUPSHE__.mainModuleData = {…,"spuList":[…],"paginate":{…}}`),
 * 48 products a page, and `?page=N` walks it. Both hosts answer a GitHub
 * runner directly (probe 39651857674); no proxy.
 *
 * The sale sets are the stores' own nav "Sale" collections: `sale-price` on the
 * US site (~1,800 products), `sale` on the CA site (~600). Each `spu` carries
 * one `skc` per colour, each its own product page (`/products/<jumpPath>`).
 *
 * Prices are major units in the site's currency (USD / CAD, `priceCurrency` in
 * the page). A row is kept only when the shop SHOWS a strikethrough:
 * `showRetailPrice: true` and `skcRetailPrice > skcDiscountPrice`. Regular
 * items carry `skcRetailPrice: null`; member-only prices (`memberOnly`) and
 * the new-visitor price (`/service/col/price`, a coupon) are never read.
 * `stockFlag: 1` = sellable.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "cupshe";

const SITES: Partial<Record<CountryCode, { origin: string; collection: string; currency: string }>> = {
  US: { origin: "https://www.cupshe.com", collection: "sale-price", currency: "USD" },
  CA: { origin: "https://ca.cupshe.com", collection: "sale", currency: "CAD" },
};
const CAP = 1500;
const MAX_PAGES = 45;
const PAUSE_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The JSON value (array/object) that starts right after `"key":` — string-aware bracket matching. Pure. */
export function extractJson(html: string, key: string): any | null {
  const at = html.indexOf(`"${key}":`);
  if (at < 0) return null;
  let i = at + key.length + 3;
  while (html[i] === " ") i++;
  const open = html[i];
  if (open !== "[" && open !== "{") return null;
  let depth = 0;
  let inStr = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (ch === "\\") j++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map one colour (`skc`) of a collection grid. Pure; null unless the shop shows it reduced. */
export function mapCupshe(skc: any, country: CountryCode): ProductRecord | null {
  const site = SITES[country];
  if (!site || !skc?.skcCode || !skc?.title || !skc?.jumpPath) return null;
  if (skc.showRetailPrice !== true || skc.memberOnly === true) return null;
  const price = num(skc.skcDiscountPrice);
  const was = num(skc.skcRetailPrice);
  if (price == null || was == null || price >= was) return null;
  const imgs: string[] = (Array.isArray(skc.medias) ? skc.medias : [])
    .filter((m: any) => m?.type === 1 && typeof m?.src === "string")
    .map((m: any) => m.src);
  const colour = typeof skc.color === "string" && skc.color.trim() ? skc.color.trim() : null;
  return {
    brand,
    country,
    externalId: String(skc.skcCode),
    name: String(skc.title).trim(),
    url: `${site.origin}/products/${String(skc.jumpPath).replace(/^\/+/, "")}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: site.currency,
    inStock: skc.stockFlag === 1,
    category: typeof skc.productTypeName === "string" ? skc.productTypeName.replace(/-New$/i, "").trim() || null : null,
    // A women's swim and resort label; no men's or kids' line in the sale sets.
    gender: "kadin",
    variants: null,
    groupKey: typeof skc.spuCode === "string" ? skc.spuCode : null,
    colorName: colour,
  };
}

/** Every reduced colour of one SSR collection page. Pure. */
export function parseCupshePage(html: string, country: CountryCode): { rows: ProductRecord[]; skcs: number; totalPage: number | null } {
  const spus = extractJson(html, "spuList");
  if (!Array.isArray(spus)) throw new Error(`cupshe/${country}: no spuList in the page — the storefront changed shape`);
  const pag = extractJson(html, "paginate");
  const rows: ProductRecord[] = [];
  let skcs = 0;
  for (const spu of spus) {
    for (const skc of spu?.skcs ?? []) {
      skcs++;
      const r = mapCupshe(skc, country);
      if (r) rows.push(r);
    }
  }
  return { rows, skcs, totalPage: num(pag?.totalPage) };
}

export async function listCupshe(country: CountryCode): Promise<ProductRecord[]> {
  const site = SITES[country];
  if (!site) return [];
  const byId = new Map<string, ProductRecord>();
  let totalPage = 1;
  for (let page = 1; page <= totalPage && page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const url = `${site.origin}/collections/${site.collection}${page > 1 ? `?page=${page}` : ""}`;
    const html = await getText(url, { country, timeoutMs: 45_000, retries: 2 });
    const p = parseCupshePage(html, country);
    if (page === 1) totalPage = p.totalPage ?? 1;
    for (const r of p.rows) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
    if (byId.size >= CAP * 1.5) break;
  }
  if (totalPage > MAX_PAGES) throw new Error(`cupshe/${country}: ${totalPage} pages exceed the ${MAX_PAGES}-page budget`);
  const all = [...byId.values()];
  if (!all.length) throw new Error(`cupshe/${country}: 0 reduced products in /collections/${site.collection}`);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listCupshe;
