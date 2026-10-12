/**
 * Altitude Sports (altitude-sports.com) — Canada only, multi-brand outdoor and
 * fashion (Vans, The North Face, Canada Goose, Arc'teryx, Columbia, Levi's, ...).
 *
 * The storefront (Next.js on commercetools) searches an Algolia app whose
 * public, search-only key sits in its JS bundle (`_app-*.js`:
 * `algoliasearch("I2Q2BWZE3K", "8b62…")`). Algolia answers a plain GET from a
 * GitHub runner — no proxy (probe run 38239192316, 2026-10-12).
 *
 * One hit = one style. `price.CAD.centAmount` is the public selling price (one
 * value, or several when colours/sizes are priced differently) and
 * `original_price.CAD.centAmount` the regular price; the product page showed
 * the same pair (CA$63.99 / CA$79.99 on Vans Sk8-Mid V, 2026-10-12), so it is
 * not a member price. `discounted_percent > 0` selects the sale. A style with
 * one price is one row; a style whose colours differ in price is split into one
 * row per reduced colour (`thumbnails[]` carries each colour's own price), so
 * no row shows a range. `attributes.size` lists the sizes in stock (the
 * product page lists exactly those variants), and `quantity_left` the units.
 *
 * Algolia stops at 1,000 hits per query, so the sale (~3,600 styles, most of
 * them Gear) is read in three walks of the bestSeller replica: the big brands,
 * then women's, then men's — apparel, footwear, accessories and bags only.
 * Kids-only styles are left out (women 18-45 audience).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "altitudesports";

const APP_ID = "I2Q2BWZE3K";
const API_KEY = "8b62285e596a476fadc22970ed58e04a"; // public search-only key from the storefront bundle
const INDEX = "PRODUCTS_ALS_en-CA_bestSeller";
const HOST = `https://${APP_ID}-dsn.algolia.net`;
const SITE = "https://www.altitude-sports.com";
const CAP = 1500;
const ATTRS = [
  "objectID",
  "slug",
  "name",
  "image_url",
  "thumbnails",
  "quantity_left",
  "price",
  "original_price",
  "discounted_percent",
  "attributes.size",
  "attributes.gender",
  "attributes.age",
  "attributes.brand_name",
  "attributes.product_type_name",
  "hierarchicalCategories",
].join(",");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shelves kept: wearables and bags, not tents, bike parts or camp stoves. */
const SHELVES =
  '(hierarchicalCategories.lvl0:Clothing OR hierarchicalCategories.lvl0:Footwear OR hierarchicalCategories.lvl0:Accessories OR "hierarchicalCategories.lvl1":"Gear > Packs and Bags")';

/** The brands this store is here for, first (TNF/UGG are rarely reduced — MAP pricing). */
export const MUST = ["The North Face", "UGG", "Vans", "Canada Goose", "Arc'teryx", "Mackage", "Moose Knuckles"];
export const BIG = [
  "Patagonia", "Nike", "adidas", "New Balance", "Columbia", "Levi's", "Salomon", "Hoka", "On", "Birkenstock", "Sorel",
  "Calvin Klein", "Lacoste", "Barbour", "Helly Hansen", "Vuori", "ASICS", "Saucony", "Brooks", "Carhartt Work In Progress",
  "RAINS", "Camper", "Dr. Martens", "Converse", "Timberland", "Veja", "Fjällräven", "Herschel Supply", "Rudsak",
];

const anyBrand = (names: string[]) => `(${names.map((b) => `attributes.brand_name:"${b.replace(/"/g, '\\"')}"`).join(" OR ")})`;

export interface Walk {
  label: string;
  filter: string;
  gender: ProductRecord["gender"];
}
export const WALKS: Walk[] = [
  { label: "must brands", filter: anyBrand(MUST), gender: null },
  { label: "big brands", filter: anyBrand(BIG), gender: null },
  { label: "women", filter: "attributes.gender:Women", gender: "kadin" },
  { label: "men", filter: "attributes.gender:Men", gender: "erkek" },
];

export function searchUrl(w: Walk): string {
  const p = new URLSearchParams({
    query: "",
    hitsPerPage: "1000",
    page: "0",
    filters: `discounted_percent > 0 AND ${SHELVES} AND ${w.filter}`,
    attributesToRetrieve: ATTRS,
    attributesToHighlight: "",
    "x-algolia-application-id": APP_ID,
    "x-algolia-api-key": API_KEY,
  });
  return `${HOST}/1/indexes/${INDEX}?${p}`;
}

const cents = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0);

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

function genderOf(attrs: any, walk: ProductRecord["gender"]): ProductRecord["gender"] | "kids" {
  const age = arr(attrs?.age);
  if (age.length && !age.includes("Adult") && age.some((a) => /youth|toddler|infant/i.test(a))) return "kids";
  const g = arr(attrs?.gender).filter((x) => x !== "NA");
  if (g.length === 1) return g[0] === "Women" ? "kadin" : g[0] === "Men" ? "erkek" : walk;
  return walk;
}

const sizeKey = (s: string) => {
  const n = parseFloat(s);
  if (Number.isFinite(n) && /^\d/.test(s)) return n;
  const letters = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL"];
  const i = letters.indexOf(s.toUpperCase());
  return i >= 0 ? 1000 + i : 2000;
};

/** Map one Algolia hit (one style) to its rows. Pure; [] unless genuinely reduced. */
export function mapAltitude(hit: any, walk: Pick<Walk, "gender">): ProductRecord[] {
  const id = String(hit?.objectID ?? "");
  const slug = String(hit?.slug ?? "");
  const title = String(hit?.name ?? "").trim();
  if (!id || !slug || !title) return [];
  const list = cents(hit?.original_price?.CAD?.centAmount);
  if (list.length !== 1) return [];
  const regular = list[0];
  const attrs = hit?.attributes ?? {};
  const gender = genderOf(attrs, walk.gender);
  if (gender === "kids") return [];

  const make = String(Array.isArray(attrs.brand_name) ? attrs.brand_name[0] ?? "" : attrs.brand_name ?? "").trim();
  const name = make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title;
  const h = hit?.hierarchicalCategories ?? {};
  const leaf = String(h.lvl2 ?? h.lvl1 ?? h.lvl0 ?? "").split(">").pop()?.trim() ?? "";
  const category = String(attrs.product_type_name ?? "").trim() || leaf || null;
  const inStock = Number(hit?.quantity_left) > 0;
  const url = `${SITE}/p/${slug}`;
  const thumbs: any[] = Array.isArray(hit?.thumbnails) ? hit.thumbnails : [];
  const colours = [...new Set(thumbs.map((t) => String(t?.color_name ?? "").trim()).filter(Boolean))];
  const labels = [...new Set(arr(attrs.size).filter((s) => s && s !== "NA"))].sort((a, b) => sizeKey(a) - sizeKey(b));
  const sizes: SizeVariant[] = labels.map((label) => ({ label, availability: "in_stock" }));
  const base = { brand, country: "CA" as const, name, url, currency: "CAD", inStock, category, gender };

  const prices = [...new Set(cents(hit?.price?.CAD?.centAmount))];
  if (prices.length === 1) {
    if (!(prices[0] < regular)) return [];
    const img = typeof hit.image_url === "string" ? hit.image_url : null;
    return [
      {
        ...base,
        externalId: id,
        imageUrl: img,
        images: cleanGallery([], img),
        price: prices[0],
        listPrice: regular,
        variants: colours.length || sizes.length ? { colors: colours, sizes } : null,
        groupKey: null,
        colorName: colours.length === 1 ? colours[0] : null,
      },
    ];
  }
  // Colours priced differently: one row per reduced colour, each at its own
  // single price. A colour still showing a range (priced by size) is skipped.
  const out: ProductRecord[] = [];
  for (const t of thumbs) {
    const p = [...new Set(cents(t?.price?.CAD?.centAmount))];
    const colour = String(t?.color_name ?? "").trim();
    if (p.length !== 1 || !(p[0] < regular) || !t?.id || !colour) continue;
    const img = typeof t.image_url === "string" ? t.image_url : null;
    out.push({
      ...base,
      externalId: `${id}-${t.id}`,
      imageUrl: img,
      images: cleanGallery([], img),
      price: p[0],
      listPrice: regular,
      variants: { colors: [colour], sizes: [] },
      groupKey: `altitudesports-${id}`,
      colorName: colour,
    });
  }
  return out;
}

export async function listAltitudeSports(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let hits = 0;
  const problems: string[] = [];
  for (const [i, w] of WALKS.entries()) {
    if (i > 0) await sleep(600);
    const data = await getJson<any>(searchUrl(w), { country, retries: 1, timeoutMs: 45_000 }).catch((e) => {
      problems.push(`${w.label}: ${String(e).slice(0, 120)}`);
      console.warn(`altitudesports: ${w.label} failed: ${String(e).slice(0, 120)}`);
      return null;
    });
    const list: any[] = Array.isArray(data?.hits) ? data.hits : [];
    hits += list.length;
    if (Number(data?.nbHits) > 1000) console.warn(`altitudesports: ${w.label} has ${data.nbHits} hits; first 1000 read`);
    for (const h of list) for (const r of mapAltitude(h, w)) if (!byId.has(r.externalId)) byId.set(r.externalId, r);
  }
  if (hits === 0) throw new Error(`altitudesports: every sale walk returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listAltitudeSports;
