/**
 * Monsoon (monsoon.co.uk) and Accessorize (accessorize.com/uk) — GBP sale
 * grids. Added 2026-11-10 (both were verified on 10-11 and left out only for the
 * old 30-per-market cap).
 *
 * Both are Salesforce Commerce Cloud sites on one codebase. The infinite-scroll
 * fragment `Search-UpdateGrid?cgid=<sale category>&start=N&sz=120` is plain
 * server-rendered HTML that answers a GitHub runner (probe run 42800582417).
 * Every tile is a `<div data-component="product/ProductTile">` whose attributes
 * carry the data: `data-component-pid`, `-url`, `-name`, `-images` (JSON) and
 * `-analytics` (JSON: `price` charged now, `wasPrice`, `stockAvailability`,
 * `variant` = the colour, `bazaar` = Monsoon or its sister label East).
 *
 * `price` is what the tile shows after the running promotion (the `coupon`
 * field names it, "30off") — the site applies it without a code. Only rows
 * with `wasPrice` above `price` are kept. The tile has no sizes.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";
import { attrOf, jsonOf } from "./_sfcchtml";

export type MonsoonSlug = "monsoon" | "accessorize";

interface MonsoonSite {
  site: string;
  /** Path prefix of product links (Accessorize lives under /uk). */
  grid: string;
  cgids: string[];
}

export const MONSOON_SITES: Record<MonsoonSlug, MonsoonSite> = {
  monsoon: {
    site: "https://www.monsoon.co.uk",
    grid: "https://www.monsoon.co.uk/on/demandware.store/Sites-monsoon-uk-Site/en_GB/Search-UpdateGrid",
    cgids: ["sale_all_womens"],
  },
  accessorize: {
    site: "https://www.accessorize.com",
    grid: "https://www.accessorize.com/on/demandware.store/Sites-accessorize-uk-Site/en_GB/Search-UpdateGrid",
    cgids: ["acc_sale"],
  },
};

const PAGE = 120;
const MAX_CALLS = Number(process.env.MONSOON_MAX_CALLS ?? 15);
const PAUSE_MS = Number(process.env.MONSOON_PAUSE_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The opening tag of every product tile on a grid page. Pure. */
export function monsoonTiles(html: string): string[] {
  const out: string[] = [];
  const re = /<div\b[^>]*data-component="product\/ProductTile"[^>]*>/g;
  for (const m of html.matchAll(re)) out.push(m[0]);
  return out;
}

/** One tile tag → record, or null. Pure. */
export function mapMonsoonTile(slug: MonsoonSlug, tag: string, country: CountryCode = "GB"): ProductRecord | null {
  const cfg = MONSOON_SITES[slug];
  const pid = attrOf(tag, "data-component-pid");
  const href = attrOf(tag, "data-component-url");
  const name = attrOf(tag, "data-component-name");
  const a = jsonOf<any>(attrOf(tag, "data-component-analytics") ?? "");
  if (!pid || !href || !name || !a) return null;
  const price = Number(a.price);
  const was = Number(a.wasPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const imgs: string[] = [];
  for (const im of jsonOf<any[]>(attrOf(tag, "data-component-images") ?? "") ?? []) {
    const u = im?.zoomURL ?? im?.absURL ?? String(im?.sources?.[0]?.srcset ?? "").split(/[\s,]/)[0];
    if (typeof u === "string" && u.startsWith("http")) imgs.push(u);
  }
  const colour = String(a.variant ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
  const maker = String(a.bazaar ?? "").trim();
  return {
    brand: slug,
    country,
    externalId: pid,
    name: name.replace(/\s+/g, " ").trim(),
    url: href.startsWith("http") ? href : `${cfg.site}${href}`,
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: !/out of stock/i.test(String(a.stockAvailability ?? "")),
    category: null,
    // East is sold on monsoon.co.uk as its own label.
    maker: maker && maker.toLowerCase() !== slug ? maker : null,
    gender: "kadin",
    variants: null,
    groupKey: a.id ? `${slug}:${a.id}` : null,
    colorName: colour,
  };
}

/** Register as `listMonsoon("monsoon" | "accessorize", country)`. GB only. */
export async function listMonsoon(slug: MonsoonSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cfg = MONSOON_SITES[slug];
  const cap = 1500;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const cgid of cfg.cgids) {
    for (let start = 0; calls < MAX_CALLS && byId.size < cap; start += PAGE) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const html = await getText(`${cfg.grid}?cgid=${cgid}&start=${start}&sz=${PAGE}`, { country, timeoutMs: 45_000 });
      const tiles = monsoonTiles(html);
      if (!tiles.length) {
        if (start === 0) throw new Error(`${slug}: sale grid ${cgid} came back without tiles`);
        break;
      }
      for (const t of tiles) {
        const r = mapMonsoonTile(slug, t, country);
        if (r && r.listPrice != null) byId.set(r.externalId, r);
      }
      if (tiles.length < PAGE) break;
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
