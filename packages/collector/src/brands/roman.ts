import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

/**
 * Roman TR (women's wear) — T-Soft storefront. Built 2026-10-18.
 *
 * T-Soft has no public listing JSON, but its infinite-scroll endpoint
 *
 *   /srv/service/content-v5/product-loader/<blockId>?link=<category>&pg=N
 *
 * returns a page of 12 product cards, and every card ships a
 * `PRODUCT_DATA.push(JSON.parse('{…}'))` line with the product id, name,
 * `total_base_price` (shelf, VAT incl.), `total_sale_price` (what it sells
 * for), `quantity` (stock), image, url and category. `463` is the product-list
 * block of Roman's category template; `sale` is the SALE tree (3,662 items on
 * 2026-10-18, every one reduced and in stock). Answers a GitHub runner with 200
 * (probe run 39124308073).
 *
 * 12 per page and no page-size switch (limit/count/pageSize/perPage all
 * ignored), so the walk is capped at MAX_PAGES (default 60 → 720 products,
 * ~60 requests) and always reads the SAME first pages, in the shop's order —
 * a rotating window would make the delist sweep mark everything outside it
 * as gone on every run. Sizes are not collected (they need a call per product).
 */
export const SITE = "https://roman.com.tr";
const BLOCK_ID = 463;
const SALE_LINK = "sale";
const MAX_PAGES = Number(process.env.ROMAN_MAX_PAGES ?? 60);
const PAUSE_MS = Number(process.env.ROMAN_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const brand = "roman";

export const romanPageUrl = (page: number, link = SALE_LINK) =>
  `${SITE}/srv/service/content-v5/product-loader/${BLOCK_ID}?link=${encodeURIComponent(link)}&pg=${page}&language=tr&currency=TL`;

/**
 * Every `PRODUCT_DATA.push(JSON.parse('…'))` object in a T-Soft html fragment.
 * The argument is a single-quoted JS string holding JSON, so it is unescaped
 * as a string literal first (`\"`, `\\u0131`, `\'`), then parsed. Pure.
 */
export function tsoftProductData(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/PRODUCT_DATA\.push\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/g)) {
    try {
      out.push(JSON.parse(JSON.parse(`"${m[1].replace(/\\'/g, "'")}"`)));
    } catch {
      /* one malformed card must not drop the page */
    }
  }
  return out;
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g").toLowerCase();

/** Map one PRODUCT_DATA object. Pure. */
export function mapRoman(p: any): ProductRecord | null {
  const sale = Number(p?.total_sale_price);
  const base = Number(p?.total_base_price);
  if (!p?.id || !p?.name || !Number.isFinite(sale) || sale <= 0) return null;
  const path = String(p.url ?? "").replace(/^\/+/, "");
  const img = typeof p.image === "string" && /^https?:\/\//.test(p.image) ? p.image : null;
  const name = String(p.name).replace(/\s+/g, " ").trim();
  const t = fold(`${p.category_path ?? ""} ${name}`);
  return {
    brand,
    country: "TR",
    externalId: String(p.id),
    name,
    url: path ? `${SITE}/${path}` : SITE,
    imageUrl: img,
    images: cleanGallery([], img),
    price: toMinor(sale),
    listPrice: Number.isFinite(base) && base - sale > 0.005 ? toMinor(base) : null,
    currency: "TRY",
    inStock: Number(p.quantity ?? 1) > 0,
    category: typeof p.category === "string" && p.category.trim() ? p.category.trim() : null,
    // A women's label: "Erkek" never appears; kids only if the shop says so.
    gender: /cocuk/.test(t) ? "cocuk" : "kadin",
    variants: null,
    groupKey: null,
    colorName: null,
  };
}

export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country !== "TR") return [];
  const byId = new Map<string, ProductRecord>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const html = await getText(romanPageUrl(page), { retries: 1 }).catch((e) => {
      if (page === 1) throw e;
      return null;
    });
    if (html == null) break;
    const rows = tsoftProductData(html);
    if (!rows.length) break;
    let fresh = 0;
    for (const p of rows) {
      const r = mapRoman(p);
      if (!r || byId.has(r.externalId)) continue;
      fresh++;
      if (r.listPrice != null) byId.set(r.externalId, r);
    }
    // Past the last page the loader answers an empty body; a page of only
    // already-seen ids would mean the same, so stop there too.
    if (fresh === 0) break;
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}
