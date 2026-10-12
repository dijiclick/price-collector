/**
 * Macy's (macys.com) — US only.
 *
 * Every macys.com HTML page and api.macys.com sit behind Akamai ("Access
 * Denied" from GitHub runners and from Turkey). The storefront's own browse
 * feed, `/xapi/discover/v1/page`, is not walled for US datacenter egress: a
 * plain GET with a browser UA answers 200 JSON from a GitHub runner (probe runs
 * 38219841663 and 38220067191, 2026-10-12). It is geo-filtered, so it 403s from
 * the Mac's Turkish line — verify on a runner, never locally.
 *
 * One request = one grid page of the site's own Sale tree ("Shop by Category"),
 * up to 120 products, ~0.5-1 MB. The walks below cover the women 18-45 slice
 * (clothing, juniors, shoes, handbags, beauty) by Best Sellers — 21 requests,
 * ~15 MB. Beauty's sale tree is mostly gift sets at full price, so it adds few rows.
 *
 * Prices: each product carries `pricing.price.tieredPrice`, the shelf price
 * ladder. Tier 0 is the regular ("[PRICE]", sometimes "Orig."/"Reg.") price,
 * tier 1 the shelf sale price ("Sale"/"Now"/"Your Choice"). Kept only when both
 * are single values: two values in a tier is a range across colours/sizes,
 * a "discount"+"regular" pair means only some colours are reduced, and
 * "$X value" is a gift-set worth, not a price. Badge promos (coupons, "with
 * code", Star Money, gift with purchase) live in `pricing.badges` and are never
 * read — the shelf sale price is the price.
 *
 * The grid carries no per-size stock (only size and colour maps), so variants
 * list colours only.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "macys";

const SITE = "https://www.macys.com";
const IMG = "https://slimages.macysassets.com/is/image/MCY/products/";
const PER_PAGE = 120;
/** The collector's own header set, pinned so a change in http.ts cannot silently change what the feed sees. */
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sale-tree categories walked, in priority order (Juniors last: it mostly repeats Clothing, so the cap trims it first). */
export const WALKS: { path: string; id: number; label: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { path: "/shop/sale/by-category/womens/clothing", id: 338161, label: "Clothing", gender: "kadin", pages: 8 },
  { path: "/shop/sale/by-category/womens/shoes", id: 13604, label: "Shoes", gender: "kadin", pages: 5 },
  { path: "/shop/sale/by-category/womens/handbags-wallets", id: 28273, label: "Handbags", gender: "kadin", pages: 3 },
  { path: "/shop/sale/by-category/beauty", id: 66190, label: "Beauty", gender: null, pages: 3 },
  { path: "/shop/sale/by-category/womens/juniors", id: 340644, label: "Juniors", gender: "kadin", pages: 2 },
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
  // `pathname` must go out with literal slashes: URLSearchParams would send
  // `%2Fshop%2F…`, which the feed answers with a 200 `{"redirect":…}` stub and no
  // grid (collector run 38220705111 got 0 products this way; probe 38221705486).
  return `${SITE}/xapi/discover/v1/page?pathname=${path}&${q}`;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", reg: "®", trade: "™" };
export const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => {
      if (ENTITIES[n.toLowerCase()]) return ENTITIES[n.toLowerCase()];
      // &eacute; &uuml; ... -> the accented letter
      const acc = /^([a-z])(acute|grave|circ|uml|tilde|cedil|ring)$/i.exec(n);
      return acc ? (acc[1] + { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧", ring: "̊" }[acc[2].toLowerCase() as "acute"]).normalize("NFC") : m;
    })
    .replace(/\s+/g, " ")
    .trim();

/** Grid items with a product (image-map tiles and ads have none). */
export function gridProducts(page: any): any[] {
  const zones: any[] = page?.body?.canvas?.rows?.flatMap((r: any) => r?.rowSortableGrid?.zones ?? []) ?? [];
  const grid = zones.find((z) => z?.sortableGrid)?.sortableGrid;
  return (grid?.collection ?? []).map((c: any) => c?.product).filter((p: any) => p && p.id != null);
}

/** Shelf {sale, list} from the price ladder, or null when it is not a clean single-price reduction. */
export function shelfPrice(tiers: any): { sale: number; list: number } | null {
  if (!Array.isArray(tiers) || tiers.length < 2) return null;
  const [reg, red] = tiers;
  if (!/^\s*((orig|reg)\.?\s*)?\[PRICE\]\s*$/i.test(String(reg?.label ?? ""))) return null; // "$210.00 value" etc.
  if (!/^\s*(sale|now|your choice|clearance)\s*\[PRICE\]\s*$/i.test(String(red?.label ?? ""))) return null; // codes, "Only", member
  const rv = reg?.values ?? [];
  const dv = red?.values ?? [];
  if (rv.length !== 1 || dv.length !== 1 || rv[0]?.type !== "regular" || dv[0]?.type !== "discount") return null;
  const list = Number(rv[0].value);
  const sale = Number(dv[0].value);
  if (!(sale > 0) || !(list > sale)) return null;
  return { sale, list };
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Map one grid product. Pure; null unless it is genuinely reduced on the shelf. */
export function mapMacys(p: any, walk: { label: string; gender: ProductRecord["gender"] }): ProductRecord | null {
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
  const colour = realColour(sel?.name);
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
    // Collections ("masterProduct") omit `available`; listed + active means buyable.
    inStock: p?.availability?.available !== false && p?.availability?.active !== false,
    category: type || walk.label,
    gender: walk.gender,
    variants: colours.length ? { colors: colours, sizes: [] } : null,
    groupKey: null,
    colorName: colour,
  };
}

export async function listMacys(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let first = true;
  let gridItems = 0;
  const problems: string[] = [];
  for (const w of WALKS) {
    for (let page = 1; page <= w.pages; page++) {
      if (!first) await sleep(400);
      first = false;
      const data = await getJson<any>(pageUrl(w.path, w.id, page), { country, retries: 1, headers: HEADERS }).catch((e) => {
        problems.push(`${w.label} p${page}: ${String(e).slice(0, 120)}`);
        console.warn(`macys: ${w.label} p${page} failed: ${String(e).slice(0, 120)}`);
        return null;
      });
      const items = gridProducts(data);
      gridItems += items.length;
      if (data && !items.length) {
        const why = data?.redirect ? `redirect to ${data.redirect.url}` : `no grid (keys: ${Object.keys(data ?? {}).join(",")})`;
        problems.push(`${w.label} p${page}: ${why}`);
        console.warn(`macys: ${w.label} p${page}: ${why}`);
      }
      for (const p of items) {
        const r = mapMacys(p, w);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const pages = Number(data?.body?.canvas?.rows?.[0]?.rowSortableGrid?.zones?.find((z: any) => z?.sortableGrid)?.sortableGrid?.model?.pagination?.numberOfPages);
      if (!items.length || (Number.isFinite(pages) && page >= pages)) break;
    }
  }
  // Every walk empty means the feed changed or refused us — fail loudly so the
  // watchdog flags it, instead of reporting "0 products" as a quiet success.
  if (gridItems === 0) throw new Error(`macys: every sale walk returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listMacys;
