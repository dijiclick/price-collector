/**
 * Shared collector for Avensia Nitro storefronts (Episerver + Voyado Elevate
 * behind the shop's own server) — Vita and KappAhl, Norway, 2026-10-11.
 *
 * A Nitro page answers its own URL with the page view-model as JSON when the
 * request carries `X-Requested-With: XMLHttpRequest` (what the site's own
 * client sends on navigation). A product-listing page's model has `products`
 * with `price.current` / `price.original` (incl. VAT, NOK major units),
 * `buyable`, images and the product url — everything a card needs. No key, no
 * cookie, no proxy: both hosts answered plain requests (GitHub probe + Mac).
 *
 * Paging differs per shop and is measured, not guessed:
 *   - vita.no ignores `page` but honours a window: `?count=N` (first call,
 *     full model with `totalProductCount`) and `?skip=S&count=E` (a bare
 *     product array, E is the END index, at most 480 per call).
 *   - kappahl.com ignores count/skip and pages 24 at a time with `?page=N`.
 *
 * Listing cards carry no per-size stock (KappAhl's lives behind a per-product
 * quick-shop call, which would blow the request budget), so `variants` stays
 * null. Only reduced rows are kept, in-stock first, capped.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export interface AvensiaSite {
  brand: string;
  origin: string;
  /** Sale listing paths, collected in order. */
  paths: string[];
  paging: "window" | "page";
  /** Best-effort gender from the product url. */
  gender?: (url: string) => ProductRecord["gender"];
  /** Category from the product url, when the shop's paths carry one. */
  category?: (url: string) => string | null;
}

const MAX_REQUESTS = 50;
const WINDOW = 240;
const PAUSE_MS = Number(process.env.AVENSIA_PAUSE_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** KappAhl: /nb-no/{salg/}?{dame|herre|barn|baby|newbie}/... */
export function kappahlGender(url: string): ProductRecord["gender"] {
  const segs = url.toLowerCase().split(/[/?#]/).filter(Boolean);
  if (segs.includes("newbie-woman")) return "kadin";
  for (const s of segs) {
    if (s === "dame") return "kadin";
    if (s === "herre") return "erkek";
    if (s === "barn" || s === "baby" || s === "newbie") return "cocuk";
  }
  return null;
}

/** KappAhl: the path segment right before the article number, e.g. "linbukser". */
export function kappahlCategory(url: string): string | null {
  const segs = url.split("?")[0].split("/").filter(Boolean);
  const s = segs.length >= 2 ? segs[segs.length - 2] : "";
  if (!s || /^(nb-no|salg|dame|herre|barn|baby|newbie)$/i.test(s)) return null;
  const t = s.replace(/-+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}

export const AVENSIA_SITES: Record<"vita" | "kappahl", AvensiaSite> = {
  vita: {
    brand: "vita",
    origin: "https://www.vita.no",
    paths: ["/tilbud"],
    paging: "window",
  },
  kappahl: {
    brand: "kappahl",
    origin: "https://www.kappahl.com",
    paths: ["/nb-no/salg", "/nb-no/kappahl-outlet"],
    paging: "page",
    gender: kappahlGender,
    category: kappahlCategory,
  },
};

const num = (x: unknown): number => (typeof x === "number" ? x : parseFloat(String(x ?? "")));
const abs = (origin: string, u: unknown): string | null =>
  typeof u === "string" && u ? (/^https?:\/\//.test(u) ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`) : null;

/** Map one Nitro ProductViewModel. Pure. */
export function mapAvensia(site: AvensiaSite, country: CountryCode, p: any): ProductRecord | null {
  const url = typeof p?.url === "string" ? p.url : null;
  const name = String(p?.displayName ?? "").trim();
  if (!url || !name || p?.isGiftCard) return null;
  const price = num(p?.price?.current?.inclVat);
  const orig = num(p?.price?.original?.inclVat);
  if (!Number.isFinite(price) || price <= 0) return null;
  const imgs = (Array.isArray(p?.images) ? p.images : []).map((im: any) => abs(site.origin, im?.url)).filter(Boolean) as string[];
  const id = String(p?.variationCode ?? p?.code ?? "").trim() || String(p?.code ?? "");
  if (!id) return null;
  const level = String(p?.stockLevel ?? "").toLowerCase();
  const inStock = p?.buyable !== false && !/^(none|out|outofstock|soldout|nostock)$/.test(level);
  const color = typeof p?.color === "string" && p.color.trim() ? p.color.trim() : null;
  return {
    brand: site.brand,
    country,
    externalId: id,
    name,
    url: abs(site.origin, url)!,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(orig) && orig > price ? toMinor(orig) : null,
    currency: COUNTRIES[country].currency,
    inStock,
    category: site.category?.(url) ?? null,
    gender: site.gender?.(url) ?? null,
    variants: null,
    colorName: color,
    groupKey: p?.code && p?.variationCode && Number(p?.variationCount) > 1 ? String(p.code) : null,
  };
}

const HEADERS = { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json" };

export async function listAvensia(site: AvensiaSite, country: CountryCode, cap = 1500): Promise<ProductRecord[]> {
  if (country !== "NO") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  const take = (rows: any[]) => {
    for (const p of rows) {
      const r = mapAvensia(site, country, p);
      if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
    }
  };
  const get = async (url: string) => {
    if (requests > 0) await sleep(PAUSE_MS);
    requests++;
    return getJson<any>(url, { headers: HEADERS, country });
  };

  for (const path of site.paths) {
    if (byId.size >= cap * 1.2 || requests >= MAX_REQUESTS) break;
    const base = `${site.origin}${path}`;
    if (site.paging === "window") {
      const first = await get(`${base}?count=${WINDOW}`);
      const total = Number(first?.totalProductCount ?? 0);
      take(first?.products ?? []);
      for (let skip = WINDOW; skip < total && requests < MAX_REQUESTS && byId.size < cap * 1.2; skip += WINDOW) {
        const rows = await get(`${base}?skip=${skip}&count=${skip + WINDOW}`).catch(() => null);
        const list = Array.isArray(rows) ? rows : rows?.products;
        if (!Array.isArray(list) || list.length === 0) break;
        take(list);
      }
    } else {
      let total = Infinity;
      for (let n = 1; requests < MAX_REQUESTS && byId.size < cap * 1.2; n++) {
        const d = await get(n === 1 ? base : `${base}?page=${n}`).catch(() => null);
        const list: any[] = d?.products ?? [];
        if (n === 1 && !list.length) throw new Error(`${site.brand}/${country}: ${path} returned no products`);
        if (!list.length) break;
        take(list);
        total = Number(d?.totalProductCount ?? total);
        const per = Number(d?.countPerPage ?? list.length) || list.length;
        if (n * per >= total) break;
      }
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}

/** Registry entry points. */
export const listVita = (country: CountryCode) => listAvensia(AVENSIA_SITES.vita, country);
export const listKappahl = (country: CountryCode) => listAvensia(AVENSIA_SITES.kappahl, country);
