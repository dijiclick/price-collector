/**
 * Monsoon + Accessorize UK — one SFCC (SFRA) platform, one adapter.
 *
 * The sale grid (`Search-UpdateGrid`, up to 200 tiles a call) renders each tile
 * with its data in attributes: `data-component-analytics` (price, wasPrice,
 * stockAvailability, master id), `data-component-pid` (the colour variant),
 * `data-component-url` and `data-component-images`. Measured 2026-10-11 from a
 * plain request; Cloudflare in front, no challenge. Sizes are not on the tile
 * (one Product-Rollover call per product would be needed), so no per-size stock.
 *
 * Coupons on the tile (`10-off-code-ext10`) are code-only offers and are NOT
 * applied — the price kept is the one the tile displays.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, decodeEntities, jsonOf, poundsOf, tagAround } from "./_sfcchtml";

export type MonsoonSlug = "monsoon" | "accessorize";

interface MonsoonSite {
  /** Origin the tile urls are relative to (Accessorize's carry the /uk prefix themselves). */
  origin: string;
  siteId: string;
  /** Sale categories with the gender the section implies. */
  cgids: { cgid: string; gender: ProductRecord["gender"] }[];
}

export const MONSOON_SITES: Record<MonsoonSlug, MonsoonSite> = {
  monsoon: {
    origin: "https://www.monsoon.co.uk",
    siteId: "monsoon-uk",
    cgids: [
      { cgid: "sale_all_womens", gender: "kadin" },
      { cgid: "sale_all_childrens", gender: "cocuk" },
    ],
  },
  accessorize: {
    origin: "https://www.accessorize.com",
    siteId: "accessorize-uk",
    cgids: [{ cgid: "acc_sale", gender: "kadin" }],
  },
};

const PAGE = 200;
const PAUSE_MS = Number(process.env.MONSOON_PAUSE_MS ?? 800);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MonsoonTile {
  analytics: any;
  pid: string | null;
  url: string | null;
  name: string | null;
  images: string[];
}

/** Every product tile on a grid page. Pure. */
export function parseMonsoonGrid(html: string): MonsoonTile[] {
  const out: MonsoonTile[] = [];
  for (const m of html.matchAll(/\sdata-component-analytics=/g)) {
    const tag = tagAround(html, m.index!);
    const analytics = jsonOf(attrOf(tag, "data-component-analytics") ?? "");
    if (!analytics || analytics.price === undefined) continue;
    const imgs = jsonOf<any[]>(attrOf(tag, "data-component-images") ?? "") ?? [];
    out.push({
      analytics,
      pid: attrOf(tag, "data-component-pid"),
      url: attrOf(tag, "data-component-url"),
      name: attrOf(tag, "data-component-name"),
      images: imgs.map((i) => i?.absURL ?? i?.url).filter((u): u is string => typeof u === "string"),
    });
  }
  return out;
}

/** "Pink (PINK)" → "Pink". */
const colourOf = (variant: unknown): string | null => {
  const s = String(variant ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return s || null;
};

/** One tile → record. Pure. */
export function mapMonsoonTile(
  slug: MonsoonSlug,
  t: MonsoonTile,
  gender: ProductRecord["gender"],
  country: CountryCode = "GB",
): ProductRecord | null {
  const a = t.analytics ?? {};
  const price = poundsOf(a.price);
  const was = poundsOf(a.wasPrice);
  const id = t.pid ?? a.option ?? a.id;
  const name = decodeEntities(String(t.name ?? a.name ?? "")).replace(/\s+/g, " ").trim();
  if (!id || !name || !t.url || !Number.isFinite(price) || price <= 0) return null;
  const site = MONSOON_SITES[slug];
  const kid = /\b(girls?|boys?|baby|kids?)\b/i.test(name);
  return {
    brand: slug,
    country,
    externalId: String(id),
    name,
    url: t.url.startsWith("http") ? t.url : `${site.origin}${t.url}`,
    imageUrl: t.images[0] ?? null,
    images: cleanGallery(t.images, t.images[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: !/out of stock|unavailable/i.test(String(a.stockAvailability ?? "")),
    category: null,
    gender: kid ? "cocuk" : gender,
    variants: null,
    groupKey: a.id ? `${slug}:${a.id}` : null,
    colorName: colourOf(a.variant),
  };
}

/** "588 products" in the grid header, or null. */
export function monsoonTotal(html: string): number | null {
  const m = html.replace(/\s+/g, " ").match(/([\d,]+) products\b/);
  const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Register as `listMonsoonGroup("monsoon" | "accessorize", country)`. GB only. */
export async function listMonsoonGroup(slug: MonsoonSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const site = MONSOON_SITES[slug];
  const cap = 1500;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const { cgid, gender } of site.cgids) {
    let total = Infinity;
    for (let start = 0; start < total && start < 3000 && byId.size < cap; start += PAGE) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const html = await getText(
        `${site.origin}/on/demandware.store/Sites-${site.siteId}-Site/en_GB/Search-UpdateGrid?cgid=${cgid}&start=${start}&sz=${PAGE}`,
        { country },
      );
      if (start === 0) total = monsoonTotal(html) ?? Infinity;
      const tiles = parseMonsoonGrid(html);
      for (const t of tiles) {
        const r = mapMonsoonTile(slug, t, gender, country);
        if (r && r.listPrice != null && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (tiles.length < PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
