/**
 * Under Armour US + Canada (underarmour.com/en-us, /en-ca) — the Constructor.io
 * index the storefront and UA's own Android app (`com.ua.shop`) search.
 * Turkey is a different shop (Akinon, underarmour.ts) and is untouched.
 *
 * Why not the website: every underarmour.com path answers a datacenter IP (and
 * headless Chrome) with HTTP 418 and a "Client Challenge" page (probe run
 * 39134299441). The search index sits on Constructor's own host and answers a
 * GitHub runner in ~1 s (probe 39136120803).
 *
 * Keys are public, one index per locale: en-us `key_Gz4VzKsXbR7b7fSh` (the app's
 * `ConstructorIoSdkManager`, service url `ezeubuswo-zone.cnstrc.com`) and en-ca
 * `key_MbFu7hkkn75UIUIA` (the web bundle's `cio.index_keys`). Each index quotes
 * its own currency in `priceCurrency`, which is checked per product.
 *
 * Walk: `browse/group_id/outlet` (the site's whole Outlet tree — US 2,309,
 * CA 1,571 products on 2026-10-18) filtered by `gender`, 200 per page. A
 * `variations_map` folds each product's SKUs by colour server-side — the same
 * grouping the app asks for — returning per colour the sale/list price span,
 * every SKU, its size and `orderable`. One record per colour that is really
 * reduced (salePrice < listPrice, single price across the colour's sizes); the
 * outlet tree also holds full-price colours of reduced styles, which are
 * dropped. `promotions` / "Price Everyone Minus Employee, ID.me, & VIP" are
 * cart/customer-group offers and are never read.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "underarmour";

/**
 * `outletFilter`: walk `browse/group_id/root` filtered to `group_id=outlet`
 * instead of browsing the outlet group. The en-ca index has answered the
 * outlet group's own browse with 0 results since ~2026-10-22 while the group
 * still lists 2,413 products and the filtered root returns all of them.
 */
export const UA_MARKETS: Partial<Record<CountryCode, { key: string; locale: string; currency: string; outletFilter?: boolean }>> = {
  US: { key: "key_Gz4VzKsXbR7b7fSh", locale: "en-us", currency: "USD" },
  CA: { key: "key_MbFu7hkkn75UIUIA", locale: "en-ca", currency: "CAD", outletFilter: true },
};

export const UA_HOST = "https://ezeubuswo-zone.cnstrc.com";
const SITE = "https://www.underarmour.com";
const PAGE = 200;
const MAX_PAGES = 16;
const CAP = 1500;
const PAUSE_MS = Number(process.env.UA_NA_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gender walks, in order (a product listed under two genders keeps the first),
 * each with its share of the cap — Women alone has more reduced colours than
 * the cap, so without shares the feed would be one gender. A walk stops paging
 * once it holds its share; shares a walk can't fill go to the others.
 */
export const UA_WALKS: { value: string; gender: ProductRecord["gender"]; share: number }[] = [
  { value: "Womens", gender: "kadin", share: 650 },
  { value: "Mens", gender: "erkek", share: 500 },
  { value: "Girls", gender: "cocuk", share: 150 },
  { value: "Boys", gender: "cocuk", share: 150 },
  { value: "Youth Unisex", gender: "cocuk", share: 50 },
];

/** Per-colour fold of a product's SKUs, computed by Constructor. */
export const UA_VARIATIONS_MAP = {
  dtype: "array",
  group_by: [{ name: "color", field: "data.colorWayId.color" }],
  values: {
    sale: { aggregation: "min", field: "data.salePrice" },
    saleMax: { aggregation: "max", field: "data.salePrice" },
    list: { aggregation: "max", field: "data.listPrice" },
    listMin: { aggregation: "min", field: "data.listPrice" },
    skus: { aggregation: "all", field: "data.sku" },
    sizes: { aggregation: "all", field: "data.facets.size" },
    ord: { aggregation: "all", field: "data.orderable" },
    colorWay: { aggregation: "first", field: "data.colorWay" },
    img: { aggregation: "first", field: "data.image_url" },
    img2: { aggregation: "first", field: "data.gridTileHoverImageURL" },
  },
};

export function uaBrowseUrl(country: CountryCode, gender: string, page: number): string {
  const m = UA_MARKETS[country]!;
  const q = new URLSearchParams({
    key: m.key,
    c: "cioand-2.30.0",
    page: String(page),
    num_results_per_page: String(PAGE),
    "filters[gender]": gender,
    variations_map: JSON.stringify(UA_VARIATIONS_MAP),
  });
  if (m.outletFilter) q.set("filters[group_id]", "outlet");
  return `${UA_HOST}/browse/group_id/${m.outletFilter ? "root" : "outlet"}?${q}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const https = (u: unknown): string | null =>
  typeof u === "string" && /^(https?:)?\/\//.test(u) ? u.replace(/^(https?:)?\/\//, "https://") : null;

/** Size labels for one colour: the size facet, or the SKU's size code when the facet repeats (bra cups). */
export function uaSizes(v: any): SizeVariant[] {
  const skus: string[] = Array.isArray(v?.skus) ? v.skus.map(String) : [];
  const facets: any[] = Array.isArray(v?.sizes) ? v.sizes : [];
  const ord: any[] = Array.isArray(v?.ord) ? v.ord : [];
  const n = Math.max(skus.length, facets.length);
  const base = Array.from({ length: n }, (_, i) => {
    const f = facets[i];
    return (Array.isArray(f) ? f : f != null ? [f] : []).map((x) => String(x).trim()).filter(Boolean).join(" / ");
  });
  const code = (i: number) => (skus[i] ?? "").split("-").slice(2).join("-").trim();
  const dup = new Set(base.filter((b, i) => b && base.indexOf(b) !== i));
  const out = new Map<string, SizeVariant>();
  for (let i = 0; i < n; i++) {
    const label = (base[i] && !dup.has(base[i]) ? base[i] : code(i)) || base[i];
    if (!label) continue;
    const availability = ord[i] === true || ord[i] === "true" ? "in_stock" : "out_of_stock";
    const prev = out.get(label);
    if (!prev || availability === "in_stock") out.set(label, { label, availability });
  }
  return [...out.values()];
}

/** One browse result → one record per genuinely reduced colour. Pure. */
export function mapUnderArmour(r: any, country: CountryCode, gender: ProductRecord["gender"]): ProductRecord[] {
  const m = UA_MARKETS[country];
  const d = r?.data;
  const id = d?.id != null ? String(d.id) : "";
  const name = typeof r?.value === "string" ? r.value.replace(/\s+/g, " ").trim() : "";
  if (!m || !id || !name || typeof d?.url !== "string") return [];
  if (d.priceCurrency && d.priceCurrency !== m.currency) return [];
  const out: ProductRecord[] = [];
  for (const v of Array.isArray(r.variations_map) ? r.variations_map : []) {
    const color = v?.color != null ? String(v.color) : "";
    const sale = num(v?.sale);
    const list = num(v?.list);
    if (!color || sale == null || list == null || !(sale < list)) continue;
    // Sizes at different prices would be a range card on the site, not one markdown.
    if (num(v.saleMax) !== sale || num(v.listMin) !== list) continue;
    const own = `${id}-${color}`;
    // A colour whose SKUs are another style's (a kids' or older style folded
    // in) has no page under this id; skip it rather than link a 404.
    const skus: string[] = Array.isArray(v.skus) ? v.skus.map(String) : [];
    if (skus.length && !skus.some((s) => s.startsWith(`${own}-`))) continue;
    // `img` is sometimes a campaign tile; prefer photos of this style+colour.
    const both = [https(v.img), https(v.img2)].filter((u): u is string => !!u);
    const photos = both.filter((u) => u.includes(own));
    const first = photos[0] ?? https(v.img2) ?? null;
    const sizes = uaSizes(v);
    const colour = typeof v.colorWay === "string" && v.colorWay.trim() ? v.colorWay.trim() : null;
    out.push({
      brand,
      country,
      externalId: own,
      name,
      url: `${SITE}/${m.locale}${d.url.startsWith("/") ? "" : "/"}${d.url}?dwvar_${id}_color=${color}`,
      imageUrl: first,
      images: cleanGallery(photos, first),
      price: toMinor(sale),
      listPrice: toMinor(list),
      currency: m.currency,
      inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : d.orderable !== false,
      category: typeof d.subHeader === "string" && d.subHeader.trim() ? d.subHeader.trim() : null,
      gender,
      variants: { colors: colour ? [colour] : [], sizes },
      groupKey: `ua:${id}`,
      colorName: colour,
    });
  }
  return out;
}

const inStockFirst = (a: ProductRecord, b: ProductRecord) => Number(b.inStock) - Number(a.inStock);

/** Take each walk's share (buyable first), then fill what is left of the cap from the rest. */
export function uaSelect(walks: ProductRecord[][], shares: number[], cap = CAP): ProductRecord[] {
  const picked: ProductRecord[] = [];
  const rest: ProductRecord[] = [];
  walks.forEach((rows, i) => {
    const sorted = [...rows].sort(inStockFirst);
    picked.push(...sorted.slice(0, shares[i] ?? 0));
    rest.push(...sorted.slice(shares[i] ?? 0));
  });
  return [...picked, ...rest.sort(inStockFirst)].slice(0, cap).sort(inStockFirst);
}

export async function listUnderArmourNa(country: CountryCode): Promise<ProductRecord[]> {
  if (!UA_MARKETS[country]) return [];
  const seen = new Set<string>();
  const refused: string[] = [];
  const perWalk: ProductRecord[][] = [];
  let pagesOk = 0;
  let requests = 0;
  for (const w of UA_WALKS) {
    const rows: ProductRecord[] = [];
    perWalk.push(rows);
    for (let page = 1; requests < MAX_PAGES && rows.filter((r) => r.inStock).length < w.share; page++) {
      if (requests++) await sleep(PAUSE_MS);
      const data = await getJson<any>(uaBrowseUrl(country, w.value, page), { country, retries: 1 }).catch((e) => {
        refused.push(`${w.value} p${page}: ${String(e?.message ?? e).slice(0, 80)}`);
        return null;
      });
      const results: any[] | undefined = data?.response?.results;
      if (!Array.isArray(results)) break;
      pagesOk++;
      for (const r of results) {
        for (const rec of mapUnderArmour(r, country, w.gender)) {
          if (seen.has(rec.externalId)) continue;
          seen.add(rec.externalId);
          rows.push(rec);
        }
      }
      const total = Number(data.response.total_num_results ?? 0);
      if (results.length < PAGE || page * PAGE >= total) break;
    }
  }
  if (refused.length) console.warn(`underarmour/${country}: ${refused.join("; ")}`);
  if (pagesOk === 0) throw new Error(`underarmour/${country}: Constructor browse refused (${refused.join("; ")})`);
  if (!seen.size) throw new Error(`underarmour/${country}: 0 reduced colours in ${pagesOk} outlet pages — the feed changed shape or the sale ended`);
  return uaSelect(perWalk, UA_WALKS.map((w) => w.share));
}

export const listProducts = listUnderArmourNa;
