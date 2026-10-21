/**
 * Shared collector for BESTSELLER's own storefronts (ONLY, VERO MODA), built
 * 2026-10-11. Both run the same Vue SSR frontend over one public catalogue
 * API on the shop's own host — no key, no cookie:
 *
 *   POST /api/catalog/{catalog}/search?useNewIndex=true
 *        body {from, size, tags:[["markdown"]]}
 *     → the markdown (reduced) style-colours of the whole shop, in-stock only,
 *       with price but no per-size stock. `tags` is what the sale PLP itself
 *       sends (its content filters are `sub-brand-* + markdown`); the bare
 *       `markdown` tag is the union of every sub-brand's sale.
 *   GET  /api/catalog/{catalog}/products?productIds=…  (up to 100 ids)
 *     → full product: price/listPrice, every size with `inStock`, EANs,
 *       gallery, colour, style number, English gender/category.
 *
 * `{catalog}` is the locale path (`de-ch`, `nb-no`) and decides the currency
 * (CHF / NOK) — not geo-IP, so a US runner gets the same prices.
 * Measured 2026-10-11: ONLY CH 3,039 / NO 3,039, VERO MODA CH 2,220 / NO 2,265
 * markdown items; ~23 requests for a full 1,500 cap.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type BestsellerBrand = "only" | "veromoda" | "jackjones" | "onlyandsons";

/**
 * EU catalogues (2026-10-21): each answers with its own price list (`eur_de`,
 * `eur_fr`, `sek`, `dkk` …) — not geo-IP. Pieces, Vila and Object are not on
 * this API (their `/api/catalog/…` answers 404), so only ONLY and VERO MODA.
 */
const EU_CATALOGS: Partial<Record<CountryCode, string>> = {
  DE: "de-de", AT: "de-at", FR: "fr-fr", ES: "es-es", IT: "it-it", NL: "nl-nl",
  IE: "en-ie", SE: "sv-se", DK: "da-dk", FI: "fi-fi", PT: "pt-pt",
};

/** Storefront origin per brand, and the catalogue (locale path) per market. */
export const BESTSELLER_SITES: Record<BestsellerBrand, { origin: string; catalogs: Partial<Record<CountryCode, string>> }> = {
  only: { origin: "https://www.only.com", catalogs: { CH: "de-ch", NO: "nb-no", ...EU_CATALOGS, BE: "nl-be" } },
  // Vero Moda Belgium (nl-be / fr-be) had 0 markdown items on 2026-10-21 — not mapped.
  veromoda: { origin: "https://www.veromoda.com", catalogs: { CH: "de-ch", NO: "nb-no", ...EU_CATALOGS } },
  // JACK & JONES (2026-10-21): same API, ~2,430 markdown items in every catalogue
  // (nl-be had only 32 — not mapped). ONLY & SONS also answers but carries ~170.
  jackjones: { origin: "https://www.jackjones.com", catalogs: { CH: "de-ch", NO: "nb-no", ...EU_CATALOGS } },
  // ONLY & SONS: NL and BE verified 2026-10-21 (runner 200); other catalogues untested.
  onlyandsons: { origin: "https://www.onlyandsons.com", catalogs: { NL: "nl-nl", BE: "nl-be" } },
};

const SEARCH_PAGE = 200;
const DETAIL_BATCH = 100;
const PAUSE_MS = Number(process.env.BESTSELLER_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LETTER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
/** Order sizes the way a size picker shows them: letters by scale, then numbers ascending. */
function sizeRank(label: string): [number, number, string] {
  const up = label.toUpperCase();
  const li = LETTER.indexOf(up.split(/[\s/]/)[0]);
  if (li >= 0) return [0, li, up];
  const n = parseFloat(up);
  return Number.isFinite(n) ? [1, n, up] : [2, 0, up];
}

/** "27" + `"32` → "27/32"; a plain size stays as it is. */
function sizeLabel(v: any): string {
  const size = String(v?.size?.name ?? "").trim();
  const len = String(v?.length?.name ?? "").replace(/["”]/g, "").trim();
  if (!size) return "";
  return len ? `${size}/${len}` : size;
}

export function bestsellerSizes(variants: unknown): SizeVariant[] {
  const by = new Map<string, boolean>();
  for (const v of Array.isArray(variants) ? variants : []) {
    const label = sizeLabel(v);
    if (!label || /^one ?size$/i.test(label)) continue;
    by.set(label, (by.get(label) ?? false) || v?.inStock === true);
  }
  return [...by.entries()]
    .sort(([a], [b]) => {
      const ra = sizeRank(a);
      const rb = sizeRank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
    })
    .map(([label, ok]) => ({ label, availability: ok ? "in_stock" : "out_of_stock" }));
}

export function bestsellerGender(p: any): ProductRecord["gender"] {
  const kid = `${p?.subBrand ?? ""} ${p?.brand ?? ""} ${p?.targetGroup ?? ""}`;
  if (/\b(kids?|junior|mini|baby|tweens?|teens?|toddler|girl|boy)\b/i.test(kid)) return "cocuk";
  const g = String(p?.englishGender ?? "");
  if (/^female$/i.test(g)) return "kadin";
  if (/^male$/i.test(g)) return "erkek";
  return null;
}

/** Map one `/products` item. Pure. Only reduced items (sales < list) are returned. */
export function mapBestseller(
  brand: BestsellerBrand,
  country: CountryCode,
  p: any,
): ProductRecord | null {
  const site = BESTSELLER_SITES[brand];
  const id = typeof p?.id === "string" ? p.id : "";
  const name = String(p?.name ?? "").trim();
  const price = Number(p?.price?.salesPrice?.amount);
  const list = Number(p?.price?.listPrice?.amount);
  if (!id || !name || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(list) || list <= price) return null;
  const cur = String(p?.price?.salesPrice?.currency ?? "");
  if (cur && cur !== COUNTRIES[country].currency) return null;

  const media: any[] = Array.isArray(p.media) ? p.media : [];
  const photos = media.filter((m) => /^image\//.test(String(m?.mimeType ?? "image/")) && typeof m?.imageUrl === "string");
  const front = photos.find((m) => m.isFrontImage)?.imageUrl ?? photos[0]?.imageUrl ?? (Array.isArray(p.images) ? p.images[0] : null) ?? null;
  const gallery = photos.length ? photos.map((m) => m.imageUrl as string) : Array.isArray(p.images) ? p.images : [];
  const sizes = bestsellerSizes(p.variants);
  const eans = [...new Set((p.variants ?? []).map((v: any) => v?.ean).filter((e: unknown) => typeof e === "string" && /^\d{8,14}$/.test(e)))] as string[];
  const colorName: string | null = p.colour?.name ?? null;
  const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : (p.variants ?? []).some((v: any) => v?.inStock);

  return {
    brand,
    country,
    externalId: id,
    name,
    url: typeof p.url === "string" && p.url.startsWith("/") ? `${site.origin}${p.url}` : `${site.origin}/${site.catalogs[country]}/product/${id}`,
    imageUrl: front,
    images: cleanGallery(gallery, front),
    price: toMinor(price),
    listPrice: toMinor(list),
    currency: COUNTRIES[country].currency,
    inStock,
    barcodes: eans.length ? eans : null,
    category: p.englishCategory || p.ediCategory || null,
    gender: bestsellerGender(p),
    variants: sizes.length || colorName ? { colors: colorName ? [colorName] : [], sizes } : null,
    groupKey: p.styleNumber ? `${brand}:${p.styleNumber}` : null,
    colorName,
  };
}

export async function listBestseller(brand: BestsellerBrand, country: CountryCode): Promise<ProductRecord[]> {
  const site = BESTSELLER_SITES[brand];
  const catalog = site.catalogs[country];
  if (!catalog) return [];
  const cap = Number(process.env.BESTSELLER_MAX ?? 1500);

  // 1) The markdown ids, search order (the API returns in-stock items only).
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let from = 0; ids.length < cap; from += SEARCH_PAGE) {
    if (from > 0) await sleep(PAUSE_MS);
    const data = await getJson<any>(`${site.origin}/api/catalog/${catalog}/search?useNewIndex=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json-patch+json", Accept: "application/json" },
      body: JSON.stringify({ from, size: SEARCH_PAGE, tags: [["markdown"]] }),
      country,
    });
    const rows: any[] = Array.isArray(data?.results) ? data.results : [];
    for (const r of rows) {
      if (typeof r?.id === "string" && !seen.has(r.id)) {
        seen.add(r.id);
        ids.push(r.id);
      }
    }
    const total = Number(data?.totalResults) || 0;
    if (rows.length < SEARCH_PAGE || from + SEARCH_PAGE >= total) break;
  }

  // 2) Full records, 100 at a time.
  const out: ProductRecord[] = [];
  for (let i = 0; i < Math.min(ids.length, cap); i += DETAIL_BATCH) {
    await sleep(PAUSE_MS);
    const q = ids.slice(i, i + DETAIL_BATCH).map((id) => `productIds=${encodeURIComponent(id)}`).join("&");
    const items = await getJson<any[]>(`${site.origin}/api/catalog/${catalog}/products?${q}`, { country }).catch(() => []);
    for (const p of Array.isArray(items) ? items : []) {
      const r = mapBestseller(brand, country, p);
      if (r) out.push(r);
    }
  }
  const uniq = [...new Map(out.map((r) => [r.externalId, r])).values()];
  return [...uniq.filter((r) => r.inStock), ...uniq.filter((r) => !r.inStock)].slice(0, cap);
}
