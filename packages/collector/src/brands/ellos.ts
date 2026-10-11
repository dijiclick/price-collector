/**
 * Ellos Norway, outlet — fashion departments only (2026-10-11). ellos.no is a
 * Nuxt storefront whose own client reads JSON from `/ssa/api/v1/one/…` on the
 * same host. No key, no cookie, no proxy.
 *
 *   1. `/ssa/api/v1/one/page?path=/outlet` → the outlet's campaign id
 *      (`content.query.campaign`, EL00000000498 today). Read every run rather
 *      than hardcoded, so a renumbered campaign does not silently empty the feed.
 *   2. `/ssa/api/v1/one/articles?campaign=…&fullPath=/outlet/<dept>&page=N` →
 *      58 articles a page, each with `currentPrice` / `originalPrice` (NOK major
 *      units) and every size with `inStock` + `stockQuantity`.
 *
 * The outlet also carries home and beauty (`/outlet/hjem-innredning`,
 * `/outlet/skjonnhet`); only dame/herre/barn are collected, and the department
 * gives the gender. Ellos sells its own lines next to other brands (adidas,
 * ONLY & SONS, Björn Borg…), so the brand is prefixed when it is not Ellos's own.
 */
import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const brand = "ellos";
export const ELLOS_MARKETS: Partial<Record<CountryCode, { origin: string; outlet: string }>> = {
  NO: { origin: "https://www.ellos.no", outlet: "/outlet" },
};

/** Department → gender and a page budget (58 rows a page; ~1,500 total). */
export const ELLOS_DEPTS: { path: string; gender: ProductRecord["gender"]; pages: number }[] = [
  { path: "dame", gender: "kadin", pages: 18 },
  { path: "herre", gender: "erkek", pages: 5 },
  { path: "barn", gender: "cocuk", pages: 5 },
];

const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True for Ellos's own labels ("Ellos Collection", "Ellos Home", "Ellos Plus collection"…). */
const ownLabel = (b: string) => /^ellos\b/i.test(b);

export function mapEllos(a: any, origin: string, gender: ProductRecord["gender"], country: CountryCode = "NO"): ProductRecord | null {
  const price = Number(a?.currentPrice);
  const list = Number(a?.originalPrice);
  if (!a?.id || !a?.name || !a?.url || !(price > 0) || a?.isGiftCard) return null;
  const vs: any[] = Array.isArray(a.variants) ? a.variants : [];
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of vs) {
    const label = String(v?.size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const q = Number(v?.stockQuantity);
    sizes.push({
      label,
      availability: v?.inStock !== true ? "out_of_stock" : Number.isFinite(q) && q > 0 && q <= 2 ? "low_on_stock" : "in_stock",
    });
  }
  const img = (u: unknown) => (typeof u === "string" ? u.replace("{size}", "800") : null);
  const imgs = [img(a.imageFront?.card), img(a.imageAlternative?.card)].filter((u): u is string => !!u);
  const b = String(a.brand ?? "").trim();
  const name = String(a.name).trim();
  const cats: string[] = Array.isArray(a.categories) ? a.categories : [];
  const oneSize = sizes.length === 1 && /^(one ?size|onesize|os)$/i.test(sizes[0].label);
  return {
    brand,
    country,
    externalId: String(a.id),
    name: b && !ownLabel(b) && !name.toLowerCase().includes(b.toLowerCase()) ? `${b} ${name}` : name,
    url: `${origin}${a.url}`,
    imageUrl: imgs[0] ?? null,
    // The asset server keys photos by query string (`b?…&n=<photo>`), so
    // cleanGallery's strip-the-query dedupe would fold front and back into one.
    images: imgs.length ? [...new Set(imgs)] : null,
    price: toMinor(price),
    listPrice: list > price ? toMinor(list) : null,
    currency: COUNTRIES[country].currency,
    inStock: vs.length ? vs.some((v) => v?.inStock === true) : true,
    category: cats.length > 1 ? String(cats[cats.length - 1]) : null,
    gender,
    variants: sizes.length && !oneSize ? { colors: a.color ? [String(a.color)] : [], sizes } : null,
    colorName: a.color ? String(a.color) : null,
  };
}

export function articlesUrl(origin: string, campaign: string, fullPath: string, page: number): string {
  const q = new URLSearchParams({ campaign, display: "products", fullPath, page: String(page) });
  return `${origin}/ssa/api/v1/one/articles?${q}`;
}

export async function listEllos(country: CountryCode = "NO"): Promise<ProductRecord[]> {
  const m = ELLOS_MARKETS[country];
  if (!m) return [];
  const page = await getJson<any>(`${m.origin}/ssa/api/v1/one/page?path=${encodeURIComponent(m.outlet)}`, { country });
  const campaign = page?.content?.query?.campaign;
  if (typeof campaign !== "string" || !campaign) throw new Error(`ellos/${country}: outlet campaign id not found`);
  const byId = new Map<string, ProductRecord>();
  for (const d of ELLOS_DEPTS) {
    for (let n = 1; n <= d.pages; n++) {
      await sleep(500);
      let data: any;
      try {
        data = await getJson<any>(articlesUrl(m.origin, campaign, `${m.outlet}/${d.path}`, n), { country, retries: 1 });
      } catch {
        break; // 404 ArticlesNotFound past the last page
      }
      const rows: any[] = data?.articles ?? [];
      for (const a of rows) {
        const r = mapEllos(a, m.origin, d.gender, country);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const last = Number(data?.pagination?.last ?? 0);
      if (!rows.length || (last && n >= last)) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listEllos;
