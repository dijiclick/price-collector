/**
 * Joe Fresh (joefresh.com/ca) — Canada only, Loblaw's apparel brand.
 *
 * The storefront is Next.js; its listing grid is filled from the site's own
 * BFF, `GET /ca/api/plp?categoryCode=…&query=promotions=clearance`, the same
 * call the browser makes when it pages the sale grid (`plp/getMoreProducts`
 * in the `_app` bundle). Akamai refuses Turkish and German IPs for the whole
 * host, but this JSON answers a GitHub runner with no proxy (probe runs
 * 39135071313, 2026-10-18) — the US egress the collector has.
 *
 * One product = one colour of one style: `colorVariantCode`
 * (`<style>_<colour>`) is stable, `code` is the first size's SKU and is what
 * the product page url ends in. `salePrice` / `regularPrice` are the public
 * shelf prices (the grid badge says "CLEARANCE 31% OFF"), never a PC Optimum
 * member price. `sizes[].disabled` is the size being sold out online.
 *
 * Women's sale (~750 colours) and men's sale (~200), 100 a page — about 11
 * requests. Kids/baby sales are left out (women 18-45 audience).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "joefresh";

export const SITE = "https://www.joefresh.com/ca";
const PAGE = 100;
const MAX_PAGES = 10;
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Walk {
  label: string;
  categoryCode: string;
  gender: ProductRecord["gender"];
}
/** The sale category codes linked from the site's own menu (Women's Sale, Men's Sale). */
export const WALKS: Walk[] = [
  { label: "women", categoryCode: "56018", gender: "kadin" },
  { label: "men", categoryCode: "56216", gender: "erkek" },
];

export function plpUrl(w: Walk, page: number): string {
  const p = new URLSearchParams({
    categoryCode: w.categoryCode,
    query: "promotions=clearance",
    sort: "popular",
    pageSize: String(PAGE),
    currentPage: String(page),
    fields: "FULL",
  });
  return `${SITE}/api/plp?${p}`;
}

/** "19.94" → 1994; anything else (empty, "null", a range) → null. */
export const cents = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return n > 0 ? n : null;
};

/** Map one listing product (one colour). Pure; null unless genuinely reduced. */
export function mapJoeFresh(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = String(p?.colorVariantCode ?? "").trim();
  const name = String(p?.name ?? "").trim();
  const path = String(p?.url ?? "").trim();
  if (!id || !name || !path.startsWith("/")) return null;
  const price = cents(p?.salePrice);
  const listPrice = cents(p?.regularPrice);
  if (price == null || listPrice == null || !(price < listPrice)) return null;
  if (/^(baby|toddler|kid|girls?|boys?)\b/i.test(name)) return null;

  const sizes: SizeVariant[] = (Array.isArray(p?.sizes) ? p.sizes : [])
    .filter((s: any) => s?.size)
    .map((s: any) => ({ label: String(s.size), availability: s.disabled ? "out_of_stock" : "in_stock" }));
  const online = p?.availability?.isDisabledOnline !== true;
  const inStock = online && (sizes.length ? sizes.some((s) => s.availability === "in_stock") : true);
  const colour = String(p?.colorCode ?? "").trim() || null;
  const style = String(p?.styleNumber ?? "").trim();
  const swatches = Array.isArray(p?.swatchData) ? p.swatchData : [];
  const img = typeof p?.images?.thumbnailDesktop === "string" ? p.images.thumbnailDesktop : null;

  return {
    brand,
    country: "CA",
    externalId: id,
    name,
    url: `${SITE}${path}`,
    imageUrl: img,
    images: cleanGallery([p?.images?.hover], img),
    price,
    listPrice,
    currency: "CAD",
    inStock,
    category: null,
    gender,
    variants: { colors: colour ? [colour] : [], sizes },
    // swatchData lists the style's other colours; each sale colour is its own row.
    groupKey: style && swatches.length > 1 ? `joefresh-${style}` : null,
    colorName: colour,
  };
}

export async function listJoeFresh(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let seen = 0;
  const problems: string[] = [];
  for (const w of WALKS) {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (seen > 0) await sleep(500);
      const data = await getJson<any>(plpUrl(w, page), { country, retries: 1, timeoutMs: 30_000 }).catch((e) => {
        problems.push(`${w.label} p${page}: ${String(e).slice(0, 120)}`);
        return null;
      });
      const list: any[] = Array.isArray(data?.products) ? data.products : [];
      seen += list.length;
      for (const p of list) {
        const r = mapJoeFresh(p, w.gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const pages = Number(data?.pagination?.numberOfPages ?? 0);
      if (!list.length || page + 1 >= pages) break;
    }
  }
  if (seen === 0) throw new Error(`joefresh: every sale page returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listJoeFresh;
