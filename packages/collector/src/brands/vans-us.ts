/**
 * Vans (US) — vans.com's server-rendered sale pages (2026-10-18).
 *
 * vans.com is VF's "Canvas" Nuxt storefront: Akamai in front, PerimeterX on
 * the catalog API (`/api/products/v2/catalog` answers every UA with a PX block,
 * even from our Hetzner box). The PAGES are served from Netlify's edge and
 * answer an Apple networking-stack User-Agent (`CFNetwork/… Darwin/…`) with the
 * full HTML, whose `__NUXT_DATA__` payload already carries the category's
 * product list (Bloomreach-backed): 48 products a page, `?page=N` for more.
 * From a GitHub runner the section pages and `?page=` both pass (probes
 * 39136646957, 39136985584); from the Hetzner box only the cached top sale page
 * does — this adapter is for the runners.
 *
 * Crawled per section (men / women / kids sale) so each row carries its
 * section's gender; a product listed in two sections is kept once, unisex.
 * Prices (USD): `price.lowCurrent` / `price.lowOriginal`. A product whose
 * current or original price is a RANGE (sizes priced differently) has no single
 * was/now pair and is skipped.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "vans";

const SITE = "https://www.vans.com";
const PAGE = 48;
const CAP = 1500;
const MAX_REQ = 20;

export const VANS_HEADERS: Record<string, string> = {
  "User-Agent": "CFNetwork/1490.0.4 Darwin/23.2.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

export const SECTIONS: [path: string, gender: ProductRecord["gender"]][] = [
  ["/en-us/c/sale/womens-sale-5413", "kadin"],
  ["/en-us/c/sale/mens-sale-5412", "erkek"],
  ["/en-us/c/sale/kids-sale-5414", "cocuk"],
];

/**
 * Nuxt 3's payload is devalue-flattened: one array, every value an index into
 * it. Rebuild the object graph (Reactive/Ref wrappers unwrapped). Pure.
 */
export function unflattenNuxt(arr: unknown[]): any {
  const memo = new Map<number, unknown>();
  const WRAP = new Set(["ShallowReactive", "Reactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError"]);
  const at = (i: unknown): unknown => {
    if (typeof i !== "number") return i;
    if (i < 0) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) {
        const r = at(v[1]);
        memo.set(i, r);
        return r;
      }
      if (v[0] === "Set" || v[0] === "Map" || v[0] === "Date" || v[0] === "BigInt") return null;
      const out: unknown[] = [];
      memo.set(i, out);
      for (const x of v) out.push(at(x));
      return out;
    }
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      memo.set(i, o);
      for (const [k, x] of Object.entries(v)) o[k] = at(x);
      return o;
    }
    return v;
  };
  return at(0);
}

/** The category listing inside a page's `__NUXT_DATA__`, or null. */
export function listingOf(html: string): { total: number; products: any[]; currency: string | null } | null {
  const raw = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return null;
  let arr: unknown[];
  try { arr = JSON.parse(raw); } catch { return null; }
  const root = unflattenNuxt(arr);
  const data = root?.data ?? {};
  for (const [k, v] of Object.entries<any>(data)) {
    if (/^\d+-\d+$/.test(k) && Array.isArray(v?.products)) {
      return { total: Number(v.total) || 0, products: v.products, currency: v.currency ?? null };
    }
  }
  return null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const bigger = (u: string) => u.replace("/images/t_Thumbnail/", "/images/f_auto,q_auto,w_900/");

export function mapVansProduct(p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const id = String(p?.id ?? "").trim();
  const name = String(p?.name ?? "").trim();
  if (!id || !name) return null;
  const pr = p?.price ?? {};
  const cur = num(pr.lowCurrent), curHi = num(pr.highCurrent);
  const was = num(pr.lowOriginal), wasHi = num(pr.highOriginal);
  if (cur == null || was == null) return null;
  if ((curHi != null && curHi !== cur) || (wasHi != null && wasHi !== was)) return null;
  if (cur >= was) return null;
  const shots: string[] = (Array.isArray(p?.gallery) ? p.gallery : [])
    .filter((g: any) => g?.type === "image" && typeof g?.src === "string")
    .map((g: any) => bigger(g.src));
  const path = String(p?.url ?? "");
  const crumbs: any[] = Array.isArray(p?.breadcrumbs) ? p.breadcrumbs : [];
  // The hero's alt text names the colour: "<name> VANS <colour> HERO".
  const alt = String((Array.isArray(p?.gallery) ? p.gallery[0]?.alt : "") ?? "");
  const colour = (alt.split(" VANS ")[1] ?? "").replace(/\s+(HERO|ALT\d+)\s*$/i, "").replace(/\s+/g, " ").trim();
  return {
    brand,
    country: "US",
    externalId: id,
    name,
    url: path.startsWith("http") ? path : `${SITE}${path}`,
    imageUrl: shots[0] ?? null,
    images: cleanGallery(shots, shots[0]),
    price: toMinor(cur),
    listPrice: toMinor(was),
    currency: "USD",
    inStock: true,
    category: String(p?.primaryCategoryName ?? crumbs[crumbs.length - 1]?.label ?? "").trim() || null,
    gender,
    variants: null,
    groupKey: p?.styleId ? `vans:${p.styleId}` : null,
    colorName: colour || null,
  };
}

export async function listVansUs(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let req = 0;
  for (const [path, gender] of SECTIONS) {
    for (let page = 1; req < MAX_REQ && byId.size < CAP; page++) {
      if (req++) await new Promise((r) => setTimeout(r, 1200));
      const html = await getText(`${SITE}${path}${page > 1 ? `?page=${page}` : ""}`, { country, headers: VANS_HEADERS, timeoutMs: 45_000 });
      const l = listingOf(html);
      if (!l) {
        // A PerimeterX block page instead of the store: keep what we have from
        // earlier pages, but never let a first-page refusal look like "no sale".
        if (!byId.size) throw new Error(`vans/US: no listing in ${path} page ${page} (blocked?)`);
        break;
      }
      if (l.currency && l.currency !== "USD") throw new Error(`vans/US: listing priced in ${l.currency}`);
      for (const p of l.products) {
        const r = mapVansProduct(p, gender);
        if (!r) continue;
        const prev = byId.get(r.externalId);
        if (!prev) byId.set(r.externalId, r);
        else if (prev.gender !== gender && prev.gender !== "cocuk") prev.gender = null;
      }
      if (!l.products.length || page * PAGE >= l.total) break;
    }
  }
  return [...byId.values()].slice(0, CAP);
}
