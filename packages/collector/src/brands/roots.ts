/**
 * Roots (Canada) — Salesforce Commerce Cloud. The sale grids are the stock
 * SFRA `Search-UpdateGrid` controller (the "load more" endpoint the site's own
 * listing pages call), which returns plain HTML tiles. Every tile carries a
 * `data-gmtProductData` JSON blob with the sale and list price, availability,
 * the colour shown, its category path and photos — so no per-product call.
 *
 * One sweep per gender sale category (women, men, kids, gender-free), 120
 * tiles per call. Measured 2026-10-11: 572 + 372 + 285 + 163 tiles, ~12 calls.
 * A tile is one colourway of a style; tiles with no list price (regular-price
 * items inside sale grids) are dropped. Tiles carry no size list.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getText } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.roots.com";
const GRID = `${ORIGIN}/on/demandware.store/Sites-RootsCA-Site/en_CA/Search-UpdateGrid`;
const PAGE = 120;
const MAX_PAGES_PER_CATEGORY = 8;
const PAUSE_MS = Number(process.env.ROOTS_PAUSE_MS ?? 1000);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ROOTS_SALE_CATEGORIES: { cgid: string; gender: ProductRecord["gender"] }[] = [
  { cgid: "SaleApparelWomen", gender: "kadin" },
  { cgid: "SaleApparelMen", gender: "erkek" },
  { cgid: "SaleApparelKids", gender: "cocuk" },
  { cgid: "SaleGenderFree", gender: null },
];

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Each tile's product JSON, in grid order. */
export function tilesOf(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/data-gmtProductData="([^"]*)"/g)) {
    try {
      out.push(JSON.parse(decode(m[1])));
    } catch {
      /* a malformed tile is skipped, not fatal */
    }
  }
  return out;
}

export function mapRootsTile(t: any, gender: ProductRecord["gender"]): ProductRecord | null {
  const sale = Number(t?.price?.sales?.value);
  const list = Number(t?.price?.list?.value);
  const style = String(t?.style ?? t?.gtmProductData?.id ?? "");
  if (!style || !(sale > 0) || !(list > sale)) return null;
  const g = t?.gtmProductData ?? {};
  const color = typeof g.colorCode === "string" && g.colorCode ? g.colorCode : null;
  const base = typeof g.productURL === "string" ? g.productURL : `${ORIGIN}/ca/en/${style}.html`;
  const photos: string[] = (t?.images?.medium ?? t?.images?.large ?? [])
    .map((i: any) => (typeof i?.url === "string" ? i.url.replace(/\?.*$/, "") : null))
    .filter(Boolean);
  const category = typeof g.category === "string" ? g.category.split("/").pop()!.trim() : null;
  return {
    brand: "roots",
    country: "CA",
    externalId: color ? `${style}-${color}` : style,
    name: String(t.productName ?? g.name ?? "").trim(),
    url: color ? `${base}?dwvar_${style}_color=${encodeURIComponent(color)}` : base,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "CAD",
    inStock: t.available !== false && t?.availability?.type !== "notavailable",
    category,
    gender,
    variants: g.colorName ? { colors: [String(g.colorName)], sizes: [] } : null,
    groupKey: `roots:${style}`,
    colorName: g.colorName ?? null,
  };
}

export async function listRoots(country: CountryCode = "CA"): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let requests = 0;
  let ok = 0;
  for (const { cgid, gender } of ROOTS_SALE_CATEGORIES) {
    for (let p = 0; p < MAX_PAGES_PER_CATEGORY && byId.size < CAP; p++) {
      if (requests++ > 0) await sleep(PAUSE_MS);
      const html = await getText(`${GRID}?cgid=${cgid}&start=${p * PAGE}&sz=${PAGE}`, { country: "CA" }).catch(() => null);
      if (html == null) break;
      ok++;
      const tiles = tilesOf(html);
      for (const t of tiles) {
        const r = mapRootsTile(t, gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (tiles.length < PAGE) break;
    }
  }
  if (ok === 0) throw new Error("roots/CA: every sale grid call failed");
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const brand = "roots";
export const listProducts = listRoots;
