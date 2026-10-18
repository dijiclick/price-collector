/**
 * COS and & Other Stories — United States (2026-10-18). The same H&M-group
 * BFF APIs as hmgroup.ts (GB/CH/NO), which answer an Android-app User-Agent
 * (`okhttp/…`) while the storefronts are Akamai-walled. Verified from a GitHub
 * runner, no proxy (probe 39134960170).
 *
 * Two things differ in the US market, which is why this is its own file:
 *   - the BFF only accepts `en-US` there (`en-GB` → 400 "not supported in
 *     market us"), and the site paths are `/en-us/…`;
 *   - & Other Stories US has no "/sale" or "/promotions/new-to-sale" page; its
 *     markdowns live under `/promotions` (~345 products on 2026-10-18, every
 *     one reduced). COS US uses the same `statuses_us = on_sale` filter as the
 *     other markets (4 products on 2026-10-18 — COS's sale is seasonal).
 * Only reduced rows are kept, in-stock first, capped.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export type HmGroupUsSlug = "cos" | "stories";

const APP_HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "application/json" };
const CAP = 1500;
const MAX_REQ = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const COS_US_PAGE = 200;
export const STORIES_US_PAGE = 200;
const STORIES_REFS: string[] = ["/promotions"];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const stockOf = (n: unknown): SizeVariant["availability"] => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "out_of_stock";
  return v <= 2 ? "low_on_stock" : "in_stock";
};

export function cosUsUrl(offset: number, limit = COS_US_PAGE): string {
  const p = new URLSearchParams({
    customerType: "regular",
    deviceType: "desktop",
    languageCode: "en",
    layout: "editorial",
    view: "lister",
    limit: String(limit),
    offset: String(offset),
    filters: JSON.stringify([{ attribute: "statuses_us", type: "set", operator: "any of", values: ["on_sale"] }]),
  });
  return `https://api.cos.com/product-search/v1/us/products?${p}`;
}

export function storiesUsUrl(ref: string, skip: number, limit = STORIES_US_PAGE): string {
  const p = new URLSearchParams({
    customerKey: "modadrop",
    sessionKey: "modadrop",
    locale: "en-US",
    touchpoint: "DESKTOP",
    pageReference: ref,
    notify: "false",
    limit: String(limit),
    skip: String(skip),
  });
  return `https://api.stories.com/product-search/v1/us/products?${p}`;
}

function finish(slug: HmGroupUsSlug, r: Omit<ProductRecord, "brand" | "country" | "currency" | "price" | "listPrice" | "images"> & { price: number | null; was: number | null; currency: unknown; gallery: string[] }): ProductRecord | null {
  const { price, was, currency, gallery, ...rest } = r;
  if (!rest.externalId || !rest.name || price == null || was == null || was <= price) return null;
  if (typeof currency === "string" && currency && currency.toUpperCase() !== "USD") return null;
  return { ...rest, brand: slug, country: "US", currency: "USD", price: toMinor(price), listPrice: toMinor(was), images: cleanGallery(gallery, rest.imageUrl) };
}

export function mapCosUs(p: any): ProductRecord | null {
  const imgs: string[] = (p?.media ?? []).map((x: any) => x?.source?.standard?.url).filter(Boolean);
  const g = String(p?.gender ?? "").toLowerCase();
  const cat = String(p?.mainCategory?.uri ?? "");
  return finish("cos", {
    externalId: String(p?.sku ?? p?.id ?? ""),
    name: String(p?.name ?? "").trim(),
    url: `https://www.cos.com/en-us/${cat ? `${cat}/` : ""}product/${p?.uri}`,
    imageUrl: p?.primaryImage?.source?.standard?.url ?? imgs[0] ?? null,
    gallery: imgs,
    price: num(p?.price?.value),
    was: num(p?.priceBeforeDiscount?.value),
    currency: p?.price?.currencyCode,
    inStock: p?.hasStock !== false,
    category: p?.details?.productType ?? null,
    gender: /^(female|women)/.test(g) ? "kadin" : /^(male|men)/.test(g) ? "erkek" : /^(kid|child)/.test(cat) ? "cocuk" : null,
    variants: null,
    groupKey: p?.parent?.sku ? `cos:${p.parent.sku}` : null,
    colorName: p?.variant?.name ?? null,
  });
}

export function mapStoriesUs(p: any): ProductRecord | null {
  const imgs: string[] = (p?.images ?? []).map((x: any) => x?.url).filter(Boolean);
  const hero = (p?.images ?? []).find((x: any) => /StillLife/.test(x?.assetType ?? ""))?.url ?? imgs[0] ?? null;
  const sizes: SizeVariant[] = (p?.sizes ?? [])
    .filter((s: any) => s?.name)
    .map((s: any) => ({ label: String(s.name), availability: stockOf(s.stock) }));
  const cat = String(p?.categoryUris?.find((u: string) => !/^(sale|new|trending|promotions|us-sale|gb-sale)/.test(u)) ?? "");
  return finish("stories", {
    externalId: String(p?.sku ?? p?.id ?? ""),
    name: String(p?.name ?? "").trim(),
    url: `https://www.stories.com/en-us/product/${p?.uri}/`,
    imageUrl: hero,
    gallery: imgs,
    price: num(p?.price?.value),
    was: num(p?.priceBeforeDiscount?.value),
    currency: p?.price?.currency,
    inStock: p?.available !== false && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock")),
    category: cat ? cat.split("/").pop()! : null,
    gender: "kadin",
    variants: sizes.length ? { colors: p?.variantName ? [p.variantName] : [], sizes } : null,
    groupKey: p?.sku ? `stories:${String(p.sku).slice(0, 7)}` : null,
    colorName: p?.variantName ?? null,
  });
}

export async function listHmGroupUs(slug: HmGroupUsSlug, country: CountryCode = "US"): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  const add = (r: ProductRecord | null) => {
    if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
  };
  let req = 0;
  const get = async (url: string) => {
    if (req++) await sleep(600);
    return getJson<any>(url, { country, headers: APP_HEADERS });
  };
  if (slug === "cos") {
    for (let off = 0; req < MAX_REQ; off += COS_US_PAGE) {
      const d = await get(cosUsUrl(off));
      const rows: any[] = d?.data?.products ?? [];
      rows.forEach((p) => add(mapCosUs(p)));
      if (!rows.length || off + COS_US_PAGE >= (d?.data?.pagination?.totalProducts ?? 0)) break;
    }
  } else {
    for (const ref of STORIES_REFS) {
      for (let skip = 0; req < MAX_REQ && byId.size < CAP * 2; skip += STORIES_US_PAGE) {
        const d = await get(storiesUsUrl(ref, skip));
        const rows: any[] = d?.data?.products ?? [];
        rows.forEach((p) => add(mapStoriesUs(p)));
        if (!rows.length || skip + STORIES_US_PAGE >= (d?.data?.pagination?.totalProducts ?? 0)) break;
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
