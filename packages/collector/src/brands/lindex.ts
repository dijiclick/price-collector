/**
 * Lindex Norway — the SALE ("salg") listing only — through the JSON API the
 * site's own Nuxt client calls (`API_BASE_URL` = https://www.lindex.com/api,
 * found in the page config 2026-10-11).
 *
 * The HTML is Akamai-walled, and so is this API for anything that asks for
 * HTML: the same URL answers a GitHub runner 200 with `Accept:
 * application/json` and 403 with the probe's browser `Accept: text/html,…`
 * (probe runs 38135871143 vs 38135930448). getJson sends JSON-only Accept, so
 * a plain request passes. No cookie, key or proxy.
 *
 * The sale page itself sends `facets[0]=has_sale_any_market_v2:sale` on each
 * top-level category; we do the same per section (that is also how gender is
 * known — Lindex has no men's department). The list carries regular + reduced
 * price per colour; per-size stock and the photo gallery only come from the
 * per-style detail call, so that is fetched for the first DETAIL_CAP styles
 * (deepest discounts first) to stay inside the request budget.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.lindex.com";
const API = `${SITE}/api`;
const IMG = "https://i8.amplience.net/i/Lindex";
const PAGE = 200;
const CAP = 1500;
const DETAIL_CAP = Number(process.env.LINDEX_DETAILS ?? 45);
const PAUSE_MS = Number(process.env.LINDEX_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Top-level sections (Fredhopper query ids from /res/categories) and who they dress. */
export const LINDEX_SECTIONS: { id: string; label: string; gender: ProductRecord["gender"] }[] = [
  { id: "catalog01_1033146_1033146a1034205", label: "Dame", gender: "kadin" },
  { id: "catalog01_1033146_1033146a1034206", label: "Undertøy", gender: "kadin" },
  { id: "catalog01_1033146_1033146a1034207", label: "Barn", gender: "cocuk" },
  { id: "catalog01_1033146_1033146a1034208", label: "Baby", gender: "cocuk" },
  { id: "catalog01_1033146_1033146a1034209", label: "Beauty", gender: null },
];

/** Markets the API serves (lowercase path/`country` code); same section ids everywhere (2026-10-21). */
export const LINDEX_MARKETS: Partial<Record<CountryCode, string>> = { NO: "no", SE: "se", FI: "fi", DK: "dk" };

export function lindexListUrl(categoryId: string, startIndex: number, country: CountryCode = "NO"): string {
  const q = new URLSearchParams({
    "categoryIds[0]": categoryId,
    country: LINDEX_MARKETS[country] ?? "no",
    pageSize: String(PAGE),
    startIndex: String(startIndex),
    "facets[0].name": "has_sale_any_market_v2",
    "facets[0].value": "sale",
    sort: "Discount",
  });
  return `${API}/products/list?${q}`;
}

export const lindexImage = (fileName: string) => `${IMG}/${encodeURIComponent(fileName)}?w=900&fmt=auto`;

/** Map one listing variant (one colour of a style). Pure. */
export function mapLindex(v: any, gender: ProductRecord["gender"], country: CountryCode = "NO"): ProductRecord | null {
  const styleId = String(v?.styleId ?? "");
  const colorId = String(v?.colorId ?? v?.variantColorId ?? "");
  const name = String(v?.name ?? "").replace(/\s+/g, " ").trim();
  const regular = Number(v?.regularPrice?.value);
  const reduced = Number(v?.reducedPrice?.value);
  if (!styleId || !colorId || !name || !Number.isFinite(regular) || regular <= 0) return null;
  const isReduced = Number.isFinite(reduced) && reduced > 0 && reduced < regular;
  const price = isReduced ? reduced : regular;
  const file = typeof v?.media?.fileName === "string" ? v.media.fileName : null;
  const img = file ? lindexImage(file) : null;
  // "Genser - Dame - Brun": the first part is the product type.
  const alt = typeof v?.media?.altText === "string" ? v.media.altText.split(" - ")[0].trim() : "";
  const slug = typeof v?.sanitizedName === "string" && v.sanitizedName ? v.sanitizedName : "p";
  return {
    brand: "lindex",
    country,
    externalId: `${styleId}-${colorId}`,
    name,
    url: `${SITE}/${LINDEX_MARKETS[country] ?? "no"}/p/${styleId}-${colorId}-${slug}`,
    imageUrl: img,
    images: img ? [img] : null,
    price: toMinor(price),
    listPrice: isReduced ? toMinor(regular) : null,
    currency: COUNTRIES[country].currency,
    inStock: v?.variantStatus ? v.variantStatus === "Available" : true,
    category: alt || null,
    gender,
    variants: null,
    groupKey: Array.isArray(v?.additionalColorIds) && v.additionalColorIds.length ? `lindex:${styleId}` : null,
  };
}

/** Fold one style-detail answer into the listing rows of that style. Pure. */
export function applyLindexDetail(rows: ProductRecord[], detail: any): void {
  const byColour = new Map<string, any>();
  for (const dv of detail?.variants ?? []) byColour.set(String(dv?.colorId), dv);
  for (const r of rows) {
    const dv = byColour.get(r.externalId.split("-")[1]);
    if (!dv) continue;
    const sizes: SizeVariant[] = [];
    const seen = new Set<string>();
    for (const s of dv.sizes ?? []) {
      const label = String(s?.sizeName ?? "").trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const sku = Number(s?.skuId);
      sizes.push({
        label,
        availability: s?.status === "Available" ? "in_stock" : "out_of_stock",
        ...(Number.isFinite(sku) && sku > 0 ? { sku } : {}),
      });
    }
    if (sizes.length && !(sizes.length === 1 && /^(one ?size|onesize|os)$/i.test(sizes[0].label))) {
      r.variants = { colors: dv.colorName ? [String(dv.colorName)] : [], sizes };
      r.inStock = sizes.some((s) => s.availability === "in_stock");
    }
    if (dv.colorName) r.colorName = String(dv.colorName);
    const gallery = (dv.mediaSet ?? [])
      .map((m: any) => (typeof m?.fileName === "string" ? lindexImage(m.fileName) : null))
      .filter(Boolean) as string[];
    r.images = cleanGallery(gallery, r.imageUrl) ?? r.images;
  }
}

export async function listLindex(country: CountryCode): Promise<ProductRecord[]> {
  const cc = LINDEX_MARKETS[country];
  if (!cc) return [];
  const opts = { country, retries: 1 } as const;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  let firstError: unknown = null;
  for (const sec of LINDEX_SECTIONS) {
    for (let start = 0; start < CAP; start += PAGE) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      let d: any;
      try {
        d = await getJson<any>(lindexListUrl(sec.id, start, country), opts);
      } catch (e) {
        firstError ??= e;
        break;
      }
      const vs: any[] = d?.payload?.variants ?? [];
      for (const v of vs) {
        const r = mapLindex(v, sec.gender, country);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const total = Number(d?.payload?.totalCount ?? 0);
      if (vs.length < PAGE || start + PAGE >= total) break;
    }
  }
  if (byId.size === 0 && firstError) throw firstError;

  // Per-size stock + gallery for the first styles (the list is sorted by discount).
  const all = [...byId.values()];
  const byStyle = new Map<string, ProductRecord[]>();
  for (const r of all) {
    const sid = r.externalId.split("-")[0];
    byStyle.set(sid, [...(byStyle.get(sid) ?? []), r]);
  }
  let details = 0;
  for (const [sid, rows] of byStyle) {
    if (details >= DETAIL_CAP) break;
    if (!rows.some((r) => r.inStock)) continue;
    details++;
    await sleep(PAUSE_MS);
    const d = await getJson<any>(`${API}/products/details/${cc}/style/${sid}`, opts).catch(() => null);
    if (d?.payload) applyLindexDetail(rows, d.payload);
  }
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
