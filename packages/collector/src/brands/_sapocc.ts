import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Shared adapter for SAP Commerce Cloud (OCC v2) shops: Vakko (`vsite`) and
 * Vakkorama (`rsite`). Both are Angular/Spartacus SPAs whose HTML is an empty
 * shell, but the OCC API behind them is public (no auth) — verified 2026-10-10.
 *
 * Listing: `products/search?query=:new-coming:allCategories:<SALE>` pages the
 * shop's Outlet tree. An empty free-text query only works with a category
 * facet; `:relevance` alone returns 0. Every search hit already carries price,
 * strike price (`firstStrikePrice`), per-size stock (`sizeDetail`), the gallery
 * and the EANs, so no per-product call is needed.
 *
 * Coverage is capped (default 2,000): the outlets hold ~12k (Vakko) and ~6k
 * (Vakkorama) items. To keep the cap from going all to one section, the
 * outlet is split by its gender facet (Kadın / Erkek / Çocuk…) and each slice
 * gets a share of the cap in proportion to its size, paged round-robin. That
 * also gives every record an exact gender instead of a guessed one.
 */

export interface OccSite {
  brand: string;
  /** OCC base incl. site id, e.g. `https://api.vakko.com/occ/v2/vsite`. */
  api: string;
  /** Storefront origin, e.g. `https://www.vakko.com`. */
  web: string;
  /** Category code of the outlet/sale tree (`312` Vakko, `203` Vakkorama). */
  saleCategory: string;
}

const PAGE_SIZE = 100;

/** `https://cdn…/mnresize/{x}/{y}/…jpg` → a 600×900 rendition (the CDN resizes on the fly). */
export function occImage(u: unknown): string | null {
  if (typeof u !== "string" || !/^https?:\/\//.test(u)) return null;
  return u.replace("{x}", "600").replace("{y}", "900").replace(/\/mnresize\/96\/96\//, "/mnresize/600/900/");
}

const foldTr = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g")
    .replace(/[Çç]/g, "c").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u").toLowerCase();

/** "Kadın" / "Erkek" / "Erkek Çocuk" / "Kız Çocuk" / "Unisex" → our gender. Kids first. */
export function occGender(label: string | null | undefined): ProductRecord["gender"] {
  const t = foldTr(label ?? "");
  if (/cocuk|bebek|kids?\b/.test(t)) return "cocuk";
  if (/kadin/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return null;
}

/** Highest strike price above `price`, or null. Major units in, major out. */
function strikeOf(p: any, price: number): number | null {
  const strikes = [p?.firstStrikePrice?.value, p?.secondStrikePrice?.value]
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > price);
  return strikes.length ? Math.max(...strikes) : null;
}

/**
 * Per-size stock from a search hit's `sizeDetail`. One-size items carry a
 * single `std` entry, which is not a size anyone picks — dropped, so the
 * product reads as sizeless and its stock comes from `inStock` alone.
 */
export function occSizes(sizeDetail: unknown): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(sizeDetail) ? sizeDetail : []) {
    const label = String(s?.size ?? "").trim();
    if (!label || /^std$/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      availability: s?.inStock === false ? "out_of_stock" : s?.lowStockAlert ? "low_on_stock" : "in_stock",
    });
  }
  return out;
}

/** Leaf category name: the product type ("Ceket", "Çanta"), last in the breadcrumb. */
function leafCategory(cats: unknown): string | null {
  const list = Array.isArray(cats) ? cats : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const n = String(list[i]?.name ?? "").trim();
    if (n && !occGender(n) && !/^outlet$/i.test(n)) return n;
  }
  return null;
}

/** Map one search hit. Only DISCOUNTED items (strike > price) are returned. */
export function mapOccProduct(
  site: Pick<OccSite, "brand" | "web">,
  p: any,
  gender: ProductRecord["gender"] = null,
): ProductRecord | null {
  const code = typeof p?.code === "string" ? p.code : "";
  const name = String(p?.name ?? "").trim();
  const price = Number(p?.price?.value);
  if (!code || !name || !Number.isFinite(price) || price <= 0) return null;
  const strike = strikeOf(p, price);
  if (strike == null) return null;

  const gallery = (Array.isArray(p.galleryImages) ? p.galleryImages : []).map(occImage);
  const primary = (Array.isArray(p.images) ? p.images : []).find((i: any) => i?.imageType === "PRIMARY");
  const imageUrl = gallery.find(Boolean) ?? occImage(primary?.url);
  const sizes = occSizes(p.sizeDetail);
  const colorName: string | null = p.productsCodes?.colorName ?? p.style ?? null;
  const skus: string[] = (p.productsCodes?.sku ?? []).filter((s: unknown) => typeof s === "string" && /^\d{8,14}$/.test(s));
  const cats: any[] = Array.isArray(p.categories) ? p.categories : [];
  const inStock = sizes.length
    ? sizes.some((s) => s.availability !== "out_of_stock")
    : p.stock?.stockLevelStatus !== "outOfStock";

  return {
    brand: site.brand,
    country: "TR",
    externalId: code,
    name,
    url: typeof p.url === "string" && p.url.startsWith("/") ? `${site.web}${p.url}` : site.web,
    imageUrl,
    images: cleanGallery(gallery, imageUrl),
    price: toMinor(price),
    listPrice: toMinor(strike),
    currency: "TRY",
    inStock,
    // The EAN of every size — what a shopper scans off the tag.
    barcodes: skus.length ? skus : null,
    category: leafCategory(cats),
    gender: gender ?? cats.map((c) => occGender(c?.name)).find(Boolean) ?? null,
    variants: sizes.length || colorName ? { colors: colorName ? [colorName] : [], sizes } : null,
    // Each colour is its own product code under one `baseProduct` (the model).
    groupKey: p.baseProduct ? `${site.brand}:${p.baseProduct}` : null,
    colorName,
  };
}

export function searchUrl(site: Pick<OccSite, "api">, query: string, page: number, pageSize = PAGE_SIZE): string {
  const q = new URLSearchParams({
    query,
    fields: "FULL",
    lang: "tr",
    curr: "TRY",
    pageSize: String(pageSize),
    currentPage: String(page),
  });
  return `${site.api}/products/search?${q}`;
}

/** The gender facet's values as ready-made sub-queries. Facet name differs by site ("CİNSİYET" / "Cinsiyet"). */
export function genderStreams(
  search: any,
): { query: string; gender: ProductRecord["gender"]; count: number }[] {
  const facet = (search?.facets ?? []).find((f: any) => foldTr(String(f?.name ?? "")) === "cinsiyet");
  return (facet?.values ?? [])
    .map((v: any) => ({
      query: String(v?.query?.query?.value ?? ""),
      gender: occGender(v?.name),
      count: Number(v?.count) || 0,
    }))
    .filter((s: { query: string }) => s.query);
}

export function makeOccAdapter(
  site: OccSite,
  opts: { maxProducts?: number; concurrency?: number } = {},
): () => Promise<ProductRecord[]> {
  return async function listProducts(): Promise<ProductRecord[]> {
    const max = opts.maxProducts ?? 2000;
    const concurrency = Math.max(1, Math.min(3, opts.concurrency ?? 3));
    const root = `:new-coming:allCategories:${site.saleCategory}`;
    // One cheap call for the facets; fall back to paging the whole outlet.
    const probe = await getJson<any>(searchUrl(site, root, 0, 1));
    const facets = genderStreams(probe);
    const total = facets.reduce((n, f) => n + f.count, 0);
    const streams = facets.map((f) => ({
      ...f,
      page: 0,
      pages: Infinity,
      taken: 0,
      // Share of the cap in proportion to the slice's size.
      quota: total > 0 ? Math.ceil((max * f.count) / total) : max,
    }));
    if (streams.length === 0) {
      streams.push({ query: root, gender: null, count: 0, page: 0, pages: Infinity, taken: 0, quota: max });
    }

    const byId = new Map<string, ProductRecord>();
    while (byId.size < max) {
      let round = streams.filter((s) => s.page < s.pages && s.taken < s.quota);
      if (round.length === 0) {
        // Every slice met its share but the cap is not full (non-discounted
        // hits are dropped): let whatever still has pages fill the rest.
        round = streams.filter((s) => s.page < s.pages);
        for (const s of round) s.quota = Infinity;
      }
      if (round.length === 0) break;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, round.length) }, async () => {
          while (next < round.length) {
            const s = round[next++];
            const page = s.page++;
            try {
              const data = await getJson<any>(searchUrl(site, s.query, page));
              s.pages = Number(data?.pagination?.totalPages) || 0;
              for (const p of data?.products ?? []) {
                const rec = mapOccProduct(site, p, s.gender);
                if (rec && !byId.has(rec.externalId)) {
                  byId.set(rec.externalId, rec);
                  s.taken++;
                }
              }
            } catch {
              s.pages = 0; // a stream that fails stops; the others carry on
            }
          }
        }),
      );
    }
    return [...byId.values()].slice(0, max);
  };
}
