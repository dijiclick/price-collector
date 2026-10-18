/**
 * Bloomingdale's US (bloomingdales.com) — US only. The AE store is a different
 * company and platform (bloomingdales.ts, Salesforce); this file is the US one.
 *
 * Bloomingdale's runs on Macy's Inc's platform, and its browse feed is the same
 * `/xapi/discover/v1/page` Macy's uses (macys.ts), with the same grid shape and
 * price ladder. Every HTML page is Akamai-walled, and the feed is geo-filtered:
 * 403 "Access Denied - Bloomingdales" from Turkey and from the Hetzner box
 * (Germany), 200 JSON from a GitHub runner. Probe runs 39135105117 and
 * 39135342727 (2026-10-18): every walk below answered 200, 0.45-0.84 MB.
 * An earlier probe 403'd because it used the wrong category id — the sale tree
 * is `/shop/sale/sale-and-clearance?id=1003304`, narrowed by its `Fob`
 * (department) facet in the pathname, exactly as the site's own facet links do.
 * Women's shoes come from the women's shoe tree's "Sale & Clearance" offer
 * facet, since the sale tree's `Fob/Shoes` mixes in men's.
 *
 * Pathnames go out with literal slashes (see macys.ts pageUrl — URL-encoded
 * slashes get a 200 redirect stub with no grid).
 *
 * Prices: the shelf ladder, read by macys.ts `shelfPrice` — tier 0 regular
 * ("Reg."/"Orig."), tier 1 the shelf sale ("Sale"/"Now"), both single values;
 * ranges and "discount + regular" (only some colours reduced) are dropped.
 * Badge promos ("Buy More, Save More", coupons) are never read. About 3 in 4
 * sale-tree tiles are clean single-price reductions.
 *
 * The grid carries no per-size stock, so variants list colours only.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { decode, gridProducts, shelfPrice } from "./macys";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "bloomingdales";

const SITE = "https://www.bloomingdales.com";
const IMG = "https://images.bloomingdalesassets.com/is/image/BLM/products/";
const PER_PAGE = 120;
const CAP = 1500;
/** Pinned like macys.ts, so a change in http.ts cannot silently change what the feed sees. */
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sale walks, in priority order. 18 requests, ~13 MB. */
export const WALKS: { path: string; id: number; label: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { path: "/shop/sale/sale-and-clearance/Fob/Women", id: 1003304, label: "Clothing", gender: "kadin", pages: 7 },
  { path: "/shop/womens-designer-shoes/all-fashion-shoes/Special_offers/Sale%20%26%20Clearance", id: 17411, label: "Shoes", gender: "kadin", pages: 4 },
  { path: "/shop/sale/sale-and-clearance/Fob/Handbags", id: 1003304, label: "Handbags", gender: "kadin", pages: 3 },
  { path: "/shop/sale/sale-and-clearance/Fob/Jewelry%20%26%20Accessories", id: 1003304, label: "Accessories", gender: null, pages: 2 },
  { path: "/shop/sale/sale-and-clearance/Fob/Beauty%20%26%20Cosmetics", id: 1003304, label: "Beauty", gender: null, pages: 2 },
];

export function pageUrl(path: string, id: number, pageIndex: number): string {
  const q = new URLSearchParams({
    id: String(id),
    _navigationType: "BROWSE",
    _shoppingMode: "SITE",
    sortBy: "BEST_SELLERS",
    productsPerPage: String(PER_PAGE),
    pageIndex: String(pageIndex),
    _application: "SITE",
    _regionCode: "US",
    currencyCode: "USD",
    _customerState: "GUEST",
    _deviceType: "DESKTOP",
  });
  return `${SITE}/xapi/discover/v1/page?pathname=${path}&${q}`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Map one grid product. Pure; null unless it is genuinely reduced on the shelf. */
export function mapBloomingdalesUs(p: any, walk: { label: string; gender: ProductRecord["gender"] }): ProductRecord | null {
  const id = p?.id != null ? String(p.id) : "";
  const path = String(p?.identifier?.productUrl ?? "");
  const title = decode(String(p?.detail?.name ?? ""));
  if (!id || !path.startsWith("/") || !title) return null;
  const price = shelfPrice(p?.pricing?.price?.tieredPrice);
  if (!price) return null;

  const make = decode(String(p?.detail?.brand ?? ""));
  const name = make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title;
  const sel = p?.traits?.colors?.selectedColor;
  const imagery = sel?.imagery?.primaryImage ? sel.imagery : p?.imagery;
  const files: string[] = [imagery?.primaryImage?.filePath, ...(imagery?.additionalImageSource ?? []).map((i: any) => i?.filePath)]
    .filter((f: unknown): f is string => typeof f === "string" && f.length > 0);
  const photos = files.map((f) => `${IMG}${f}?wid=1200&fmt=jpeg&qlt=85`);
  const realColour = (c: unknown) => {
    const s = decode(String(c ?? ""));
    return s && !/^no colou?r$/i.test(s) ? s : null;
  };
  const seen = new Set<string>();
  const colours: string[] = [];
  for (const c of p?.traits?.colors?.colorMap ?? []) {
    const s = realColour(c?.name);
    if (s && !seen.has(s.toLowerCase())) seen.add(s.toLowerCase()), colours.push(s);
  }
  const type = p?.detail?.typeName ? titleCase(String(p.detail.typeName)) : "";

  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: SITE + path,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(price.sale),
    listPrice: toMinor(price.list),
    currency: "USD",
    // Collection tiles omit `available`; listed + active means buyable.
    inStock: p?.availability?.available !== false && p?.availability?.active !== false,
    category: type || walk.label,
    gender: walk.gender,
    variants: colours.length ? { colors: colours, sizes: [] } : null,
    groupKey: null,
    colorName: realColour(sel?.name),
  };
}

export async function listBloomingdalesUs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  let gridItems = 0;
  const problems: string[] = [];
  for (const w of WALKS) {
    let prev = "";
    for (let page = 1; page <= w.pages; page++) {
      if (!first) await sleep(400);
      first = false;
      const data = await getJson<any>(pageUrl(w.path, w.id, page), { country, retries: 1, headers: HEADERS }).catch((e) => {
        problems.push(`${w.label} p${page}: ${String(e).slice(0, 120)}`);
        console.warn(`bloomingdales/US: ${w.label} p${page} failed: ${String(e).slice(0, 120)}`);
        return null;
      });
      const items = gridProducts(data);
      gridItems += items.length;
      if (data && !items.length) {
        const why = data?.redirect ? `redirect to ${data.redirect.url}` : `no grid (keys: ${Object.keys(data ?? {}).join(",")})`;
        problems.push(`${w.label} p${page}: ${why}`);
        console.warn(`bloomingdales/US: ${w.label} p${page}: ${why}`);
      }
      for (const p of items) {
        const r = mapBloomingdalesUs(p, w);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      // numberOfPages is 0 on this feed, so stop on a short or repeated page instead.
      const sig = items.slice(0, 3).map((p) => p.id).join(",");
      if (items.length < PER_PAGE || sig === prev) break;
      prev = sig;
    }
  }
  if (gridItems === 0) throw new Error(`bloomingdales/US: every sale walk returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
