/**
 * heine (DE/AT/CH) and sheego (DE) — the Witt-group shop platform, sale
 * listings (2026-11-10). One family: `listWitt(slug, country)`.
 *
 * ROUTE. Both shops are the same Next.js app (assets on `cdn.wcc.<shop>`,
 * photos on `cdn.witt.info`). Its `/api/rpc` answers 401, but every listing
 * page carries its products in the React flight data
 * (`self.__next_f.push([1,"…"])`): `"productListing":{"meta":{…},"products":
 * [ … ]}` and `"pagination":{"activePage","pageCount","totalItemsCount"}`.
 * A product = one colour of a style: `id` (→ `/p/<id>`), `masterKey` (the
 * style), `name` (product type), `mainTitle`, `masterCategory`
 * ("Bekleidung|Damen|Pullover|Strickpullover"), `brand`, `price{currency,
 * min, old, priceRange, savingRange}` in minor units, `images[].hash`,
 * `colors[]` (this colour is the one whose id equals the product id).
 * Repeated objects are flight references: `"brand":"$a:1:…:products:0:brand"`
 * points at the brand of product 0 of the same list — resolved here.
 *
 * Paging is `?page=N`. The server renders the first 36 of a page's 72
 * products; the browser fetches the other half through the walled RPC, so a
 * sweep sees every other block of 36 (heine.de Mode: 35 pages → ~1,260 of
 * 2,510). The same URL with the header `RSC: 1` answers the bare flight data
 * (~24 KB gzip instead of ~90 KB) — not used, the HTML is the stabler route.
 *
 * Kept: `old` > `min` in the market's currency, and not a spread across sizes
 * (`priceRange` / `savingRange` — "ab 29,99 €" against the dearest size's old
 * price). heine and sheego sell their own labels, so `old` is their own
 * earlier price, not a maker's UVP. Listings hold only orderable products; no
 * size run is exposed, so `variants` stays null.
 *
 * Measured 2026-11-10 (sale styles): heine.de Mode 2,510 / Schuhe 364 /
 * Accessoires 78; heine.at Mode 1,271 (EUR); heine.ch Mode 1,771 (CHF);
 * sheego.de /sale 940. sheego.at/.ch/.nl did not resolve from the Mac;
 * heine.nl is not a shop.
 *
 * RUNNER: probe runs 42801443706 and 42803582756 — heine.de/.at/.ch
 * /sale/mode (page 1–3) and sheego.de/sale?page=2 answer a GitHub runner 200
 * via nginx with the full page (818,630 / 813,713 / 870,232 / 646,487 bytes).
 * The flight data starts ~680 KB into the HTML, past what the probe keeps, so
 * the same URLs were also probed with `RSC: 1`: 36 products each, `"currency":
 * "EUR"` on .de/.at and `"CHF"` on .ch, `pageCount` 35 / 18 / 25 / 14.
 *
 * ≤ 43 pages a market (heine.de), one request at a time.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export type WittSlug = "heine" | "sheego";

export interface WittShop {
  slug: WittSlug;
  origin: string;
  currency: string;
  /** Label used when a product carries no brand. */
  label: string;
  /** Sale listings to walk, in order, each with its page cap. */
  paths: { path: string; pages: number }[];
}

const HEINE_PATHS = [
  { path: "/sale/mode", pages: 35 },
  { path: "/sale/schuhe", pages: 6 },
  { path: "/sale/accessoires", pages: 2 },
];

export const WITT_SHOPS: Record<WittSlug, Partial<Record<CountryCode, WittShop>>> = {
  heine: {
    DE: { slug: "heine", origin: "https://www.heine.de", currency: "EUR", label: "heine", paths: HEINE_PATHS },
    AT: { slug: "heine", origin: "https://www.heine.at", currency: "EUR", label: "heine", paths: HEINE_PATHS },
    CH: { slug: "heine", origin: "https://www.heine.ch", currency: "CHF", label: "heine", paths: HEINE_PATHS },
  },
  sheego: {
    DE: { slug: "sheego", origin: "https://www.sheego.de", currency: "EUR", label: "sheego", paths: [{ path: "/sale", pages: 20 }] },
  },
};

const IMG = "https://cdn.witt.info/";
const CAP = 1500;
const PAUSE_MS = Number(process.env.WITT_PAUSE_MS ?? 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The page's React flight data, chunks decoded and joined (a bare `RSC: 1` body passes through). Pure. */
export function flightOf(html: string): string {
  if (!html.includes("self.__next_f.push(")) return html;
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]);
    } catch {
      // an undecodable chunk is skipped
    }
  }
  return out;
}

/** The JSON value (object or array) that starts at `from`, by bracket matching outside strings. */
function jsonAt(s: string, from: number): any | null {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) {
      try {
        return JSON.parse(s.slice(from, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface WittPage {
  products: any[];
  pageCount: number | null;
}

/** The listing's products (brand references resolved) and its page count. Pure. */
export function parseListing(html: string): WittPage {
  const fl = flightOf(html);
  const at = fl.indexOf('"productListing":{');
  const start = at < 0 ? -1 : fl.indexOf('"products":[', at);
  const list = start < 0 ? null : jsonAt(fl, start + '"products":'.length);
  const products: any[] = Array.isArray(list) ? list.filter((p) => p && typeof p === "object") : [];
  for (const p of products) {
    // "$a:1:props:…:products:0:brand" → the brand object of product 0.
    const ref = typeof p.brand === "string" ? p.brand.match(/:products:(\d+):brand$/) : null;
    if (ref) {
      const target = products[Number(ref[1])]?.brand;
      p.brand = target && typeof target === "object" ? target : null;
    } else if (typeof p.brand === "string") p.brand = null;
  }
  const pc = fl.match(/"pagination":\{[^}]*"pageCount":(\d+)/)?.[1];
  return { products, pageCount: pc ? Number(pc) : null };
}

/** One listing product → record, or null when it is not a clean struck-price row. Pure. */
export function mapWitt(p: any, shop: WittShop, country: CountryCode): ProductRecord | null {
  const id = clean(String(p?.id ?? ""));
  const pr = p?.price;
  if (!/^\d+$/.test(id) || !pr || pr.currency !== shop.currency) return null;
  const price = Number(pr.min);
  const was = Number(pr.old);
  if (!Number.isInteger(price) || price <= 0 || !Number.isInteger(was) || was <= price) return null;
  // A spread across sizes: "ab" price against another size's old price.
  if (pr.priceRange || pr.savingRange) return null;
  const cat = clean(p.masterCategory).split("|").map((s) => s.trim()).filter(Boolean);
  const section = (cat[1] ?? "").toLowerCase();
  if (/kinder|mädchen|jungen|baby/.test(section)) return null;
  if (cat[0] && !/bekleidung|schuhe|wäsche|accessoires|bademode|taschen|schmuck|sport/i.test(cat[0])) return null;
  const title = clean(p.mainTitle) || clean(p.name);
  if (!title) return null;
  const maker = clean(p.brand?.name) || shop.label;
  const name = title.toLowerCase().startsWith(maker.toLowerCase()) ? title : `${maker} ${title}`;
  const imgs = (Array.isArray(p.images) ? p.images : [])
    .map((im: any) => (typeof im?.hash === "string" && /^images\/[\w.-]+$/.test(im.hash) ? `${IMG}${im.hash}?width=800` : null))
    .filter((u: string | null): u is string => !!u);
  const color = clean((Array.isArray(p.colors) ? p.colors : []).find((c: any) => String(c?.id) === id)?.label);
  const master = clean(String(p.masterKey ?? ""));
  return {
    brand: shop.slug,
    country,
    externalId: id,
    name,
    url: `${shop.origin}/p/${id}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price,
    listPrice: was,
    currency: shop.currency,
    inStock: true,
    category: clean(p.name) || cat[cat.length - 1] || null,
    maker,
    gender: /herren|männer/.test(section) ? "erkek" : /damen/.test(section) ? "kadin" : null,
    variants: null,
    groupKey: master ? `${shop.slug}:${master}` : null,
    colorName: color || null,
  };
}

export async function listWitt(
  slug: WittSlug,
  country: CountryCode,
  fetchHtml: (u: string) => Promise<string> = (u) =>
    getText(u, { country, timeoutMs: 60_000, headers: { "Accept-Language": `de-${country},de;q=0.9` } }),
): Promise<ProductRecord[]> {
  const shop = WITT_SHOPS[slug]?.[country];
  if (!shop) return [];
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const { path, pages } of shop.paths) {
    let last = pages;
    for (let page = 1; page <= Math.min(pages, last); page++) {
      if (calls) await sleep(PAUSE_MS);
      let html: string;
      try {
        html = await fetchHtml(`${shop.origin}${path}${page > 1 ? `?page=${page}` : ""}`);
      } catch (err) {
        if (calls === 0) throw err;
        break;
      }
      calls++;
      const { products, pageCount } = parseListing(html);
      if (calls === 1 && products.length === 0) throw new Error(`${slug}/${country}: no products in the sale page's flight data (markup changed?)`);
      if (products.length === 0) break;
      if (pageCount != null) last = pageCount;
      for (const p of products) {
        const r = mapWitt(p, shop, country);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
    }
  }
  const out = [...byId.values()].slice(0, CAP);
  console.log(`${slug}/${country}: ${calls} pages, ${byId.size} reduced, kept ${out.length}`);
  return out;
}
