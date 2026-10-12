/**
 * Zappos (zappos.com) — US only, multi-brand. Brings in the big brands whose own
 * sites are walled for us (The North Face, UGG, Vans, ...).
 *
 * The storefront's own search backend, `prod.olympus.zappos.com/Search/zso/…`,
 * answers a plain GET with JSON from a GitHub runner — no proxy, no token (probe
 * run 38239192316, 2026-10-12). It is the same call zappos.com's React app makes.
 *
 * Filters ride in the `.zso` path segment: a base64url protobuf, decoded from
 * the site's own facet links (2026-10-12):
 *   field 1  (varint) department (zc1): 27567 Shoes, 27563 Clothing, 27496 Bags
 *   field 12 (packed) real brand ids, OR'd
 *   field 24 (varint) gender: 1 Women, 2 Men, 3 Girls, 4 Boys
 *   field 28 (varint) on sale = 1
 *   field 44 (packed) the field numbers above, in the order applied
 * `limit` (up to 500) and 1-based `page` paginate; `s=recentSalesStyle/desc` is
 * the site's "Best Sellers" sort; `includes` asks for the extra result fields.
 *
 * One result = one colour (style). `price`/`originalPrice` are the shelf
 * prices; a row is kept only when original > price. `onHand` is the colour's
 * total stock, and `hc_women_size`/`hc_men_size` list the shoe sizes that are
 * in stock in that colour (checked against the product bundle 2026-10-12), so
 * shoes carry per-size stock. Clothing has no in-stock size field here.
 *
 * Walk order: The North Face, UGG and Vans first (the reason this store is
 * here), then the women's and men's sale of the big brands, by best sellers.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "zappos";

const API = "https://prod.olympus.zappos.com/Search/zso";
const SITE = "https://www.zappos.com";
const IMG = "https://m.media-amazon.com/images/I/";
const CAP = 1500;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};
const INCLUDES = [
  "onHand",
  "txAttrFacet_Gender",
  "productType",
  "categoryFacet",
  "subCategoryFacet",
  "styleColor",
  "imageMap",
  "onSale",
  "productSeoUrl",
  "hc_women_size",
  "hc_men_size",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** realBrandNameFacet ids, read from zappos.com's own brand facet links (2026-10-12). */
export const BRAND_IDS: Record<string, number> = {
  "The North Face": 610,
  UGG: 288,
  Vans: 171,
  Nike: 111,
  adidas: 1,
  "New Balance": 107,
  Converse: 36,
  PUMA: 125,
  ASICS: 11,
  HOKA: 3351,
  On: 4038,
  Reebok: 128,
  Saucony: 140,
  Brooks: 26,
  "Steve Madden": 155,
  "Sam Edelman": 632,
  "Dr. Martens": 49,
  Birkenstock: 194,
  Columbia: 334,
  "Free People": 2621,
  "Levi's": 90,
  "Calvin Klein": 1192,
  "Michael Kors": 1162,
  "Kate Spade New York": 1038,
  "Tory Burch": 3379,
  "Marc Jacobs": 1157,
  COACH: 3832,
  Madewell: 5101,
  "Dolce Vita": 1284,
  "DV Dolce Vita": 2198,
  "Vince Camuto": 1217,
  Vince: 2993,
  "Stuart Weitzman": 426,
  "Kurt Geiger London": 4863,
  "Marc Fisher LTD": 4378,
  "Franco Sarto": 287,
  "Nine West": 291,
  Blondo: 3411,
  "Jessica Simpson": 1147,
  SOREL: 353,
  Timberland: 160,
  Teva: 159,
  Crocs: 899,
  "Hey Dude": 4792,
  SKECHERS: 149,
  "Beyond Yoga": 3965,
  Sanctuary: 3023,
  "Lucky Brand": 969,
  GUESS: 77,
  "Tommy Hilfiger": 935,
  "Lauren Ralph Lauren": 358,
  "Polo Ralph Lauren": 511,
  "Abercrombie & Fitch": 5689,
  AllSaints: 4847,
  Lacoste: 1196,
  Barbour: 7023,
  "Arc'teryx": 3857,
  Salomon: 611,
  "Under Armour": 2387,
  "Cole Haan": 1757,
  Clarks: 272,
  KEEN: 427,
  Merrell: 439,
};

const ids = (names: string[]) => names.map((n) => BRAND_IDS[n]);
const MUST = ["The North Face", "UGG", "Vans"];
const WOMEN = [
  "Nike", "adidas", "New Balance", "Converse", "PUMA", "ASICS", "HOKA", "On", "Reebok", "Saucony", "Brooks",
  "Steve Madden", "Sam Edelman", "Dr. Martens", "Birkenstock", "Columbia", "Free People", "Levi's", "Calvin Klein",
  "Michael Kors", "Kate Spade New York", "Tory Burch", "Marc Jacobs", "COACH", "Madewell", "Dolce Vita",
  "DV Dolce Vita", "Vince Camuto", "Vince", "Stuart Weitzman", "Kurt Geiger London", "Marc Fisher LTD",
  "Franco Sarto", "Nine West", "Blondo", "Jessica Simpson", "SOREL", "Timberland", "Teva", "Crocs", "Hey Dude",
  "SKECHERS", "Beyond Yoga", "Sanctuary", "Lucky Brand", "GUESS", "Tommy Hilfiger", "Lauren Ralph Lauren",
  "Polo Ralph Lauren", "Abercrombie & Fitch", "AllSaints", "Lacoste", "Barbour", "Arc'teryx", "Salomon",
];
const MEN = [
  "Nike", "adidas", "New Balance", "Converse", "PUMA", "ASICS", "HOKA", "On", "Reebok", "Saucony", "Brooks",
  "Dr. Martens", "Birkenstock", "Columbia", "Levi's", "Calvin Klein", "Tommy Hilfiger", "Polo Ralph Lauren",
  "Lacoste", "AllSaints", "Abercrombie & Fitch", "Barbour", "Arc'teryx", "Salomon", "Timberland", "SOREL", "Teva",
  "Crocs", "Hey Dude", "SKECHERS", "Under Armour", "Cole Haan", "Clarks", "KEEN", "Merrell", "Michael Kors",
];

/** Departments (zc1). */
export const SHOES = 27567;
export const CLOTHING = 27563;
export const BAGS = 27496;

export interface Walk {
  label: string;
  brands: number[];
  gender: 1 | 2;
  zc1?: number;
  pages: number;
  limit: number;
}
/**
 * Best sellers dominate with shoes (Zappos' core), so clothing and bags get
 * their own women's walks; men's come last, which the cap trims first.
 */
export const WALKS: Walk[] = [
  { label: "TNF/UGG/Vans women", brands: ids(MUST), gender: 1, pages: 2, limit: 500 },
  { label: "TNF/UGG/Vans men", brands: ids(MUST), gender: 2, pages: 1, limit: 500 },
  { label: "women clothing", brands: ids(WOMEN), gender: 1, zc1: CLOTHING, pages: 1, limit: 300 },
  { label: "women bags", brands: ids(WOMEN), gender: 1, zc1: BAGS, pages: 1, limit: 100 },
  { label: "women", brands: ids(WOMEN), gender: 1, pages: 1, limit: 500 },
  { label: "men", brands: ids(MEN), gender: 2, pages: 1, limit: 400 },
];

const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};

/** The `.zso` filter segment: brands OR'd, one gender, on sale (and optionally a department). */
export function zso(f: { brands?: number[]; gender?: number; zc1?: number; onSale?: boolean }): string {
  const bytes: number[] = [];
  const order: number[] = [];
  if (f.zc1) bytes.push(...varint(1 << 3), ...varint(f.zc1)), order.push(1);
  if (f.brands?.length) {
    const packed = f.brands.flatMap(varint);
    bytes.push(...varint((12 << 3) | 2), ...varint(packed.length), ...packed);
    order.push(12);
  }
  if (f.gender) bytes.push(...varint(24 << 3), ...varint(f.gender)), order.push(24);
  if (f.onSale !== false) bytes.push(...varint(28 << 3), 1), order.push(28);
  const o = order.flatMap(varint);
  bytes.push(...varint((44 << 3) | 2), ...varint(o.length), ...o);
  return Buffer.from(bytes).toString("base64url");
}

export function searchUrl(w: Walk, page: number): string {
  const q = new URLSearchParams({
    limit: String(w.limit),
    page: String(page),
    includes: JSON.stringify(INCLUDES),
    s: "recentSalesStyle/desc",
  });
  return `${API}/sale/${zso({ brands: w.brands, gender: w.gender, zc1: w.zc1 })}.zso?${q}`;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", reg: "®", trade: "™", mdash: "—", ndash: "–" };
export const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

/** "$1,148.50" → 1148.5; anything else (ranges, blanks) → null. */
export function dollars(v: unknown): number | null {
  const m = /^\s*\$?\s*([\d,]+(?:\.\d+)?)\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Photo order on the product page: main shot first, then the angles. */
const ANGLES = ["MAIN", "PAIR", "FRNT", "TOPP", "LEFT", "RGHT", "BACK", "BOTT"];
const photo = (id: string) => `${IMG}${encodeURIComponent(id)}._AC_SR800,1000_.jpg`;

const sizeKey = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 1e6;
};

/** Map one search result (one colour). Pure; null unless it is genuinely reduced. */
export function mapZappos(r: any, walk: Pick<Walk, "gender">): ProductRecord | null {
  const productId = r?.productId != null ? String(r.productId) : "";
  const styleId = r?.styleId != null ? String(r.styleId) : "";
  const title = decode(String(r?.productName ?? "")).replace(/\s*[®™]/g, "");
  if (!productId || !styleId || !title) return null;
  const sale = dollars(r?.price);
  const list = dollars(r?.originalPrice);
  if (sale == null || list == null || !(list > sale)) return null;

  const make = decode(String(r?.brandName ?? "")).replace(/[®™]/g, "").trim();
  const name = make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title;
  const path = String(r?.productSeoUrl || r?.productUrl || "").replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith("/")) return null;

  const map = r?.imageMap && typeof r.imageMap === "object" ? r.imageMap : {};
  // Shoes use angle keys (PAIR, FRNT, ...), clothing numbered ones (PT01, PT02, ...).
  const keys = [...ANGLES, ...Object.keys(map).filter((k) => !ANGLES.includes(k)).sort()];
  const shots = [...keys.map((k) => map[k]), r?.msaImageId].filter((x): x is string => typeof x === "string" && x.length > 0);
  const photos = [...new Set(shots)].map(photo);

  const genders: string[] = Array.isArray(r?.txAttrFacet_Gender) ? r.txAttrFacet_Gender : [];
  const gender: ProductRecord["gender"] = walk.gender === 1 ? "kadin" : walk.gender === 2 ? "erkek" : null;
  // Shoes: the in-stock sizes of this colour for the walk's gender (unisex
  // shoes carry both runs; the walk decides which one a shopper sees).
  const run: unknown = walk.gender === 2 ? r?.hc_men_size : r?.hc_women_size;
  const labels = Array.isArray(run) ? [...new Set(run.map(String))].sort((a, b) => sizeKey(a) - sizeKey(b)) : [];
  const sizes: SizeVariant[] = labels.map((label) => ({ label, availability: "in_stock" }));

  const type = String(r?.productType ?? "");
  const cat = decode(String(r?.categoryFacet ?? ""));
  const sub = decode(String(r?.subCategoryFacet ?? ""));
  // Shoes: the category is the type ("Boots" / "Mid-Calf") unless it is the
  // generic "Shoes" ("Shoes" / "Sneakers and Athletic Shoes"); clothing and
  // bags: the subcategory is ("Bottoms" / "Shorts").
  const category = (type === "Shoes" && cat && cat !== "Shoes" ? cat : sub || cat) || type || null;
  const colour = decode(String(r?.color ?? r?.styleColor ?? "")) || null;
  const onHand = Number(r?.onHand);

  return {
    brand,
    country: "US",
    externalId: styleId,
    name,
    url: SITE + path,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0] ?? null),
    price: toMinor(sale),
    listPrice: toMinor(list),
    currency: "USD",
    inStock: r?.onHand == null ? true : onHand > 0,
    category,
    gender: genders.length && !genders.some((g) => /^(wo)?men$/i.test(g)) ? "cocuk" : gender,
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: `zappos-${productId}`,
    colorName: colour,
  };
}

export async function listZappos(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "US") return [];
  const byId = new Map<string, ProductRecord>();
  let results = 0;
  const problems: string[] = [];
  let first = true;
  for (const w of WALKS) {
    for (let page = 1; page <= w.pages; page++) {
      if (!first) await sleep(500);
      first = false;
      const data = await getJson<any>(searchUrl(w, page), { country, retries: 1, headers: HEADERS, timeoutMs: 45_000 }).catch((e) => {
        problems.push(`${w.label} p${page}: ${String(e).slice(0, 120)}`);
        console.warn(`zappos: ${w.label} p${page} failed: ${String(e).slice(0, 120)}`);
        return null;
      });
      const items: any[] = Array.isArray(data?.results) ? data.results : [];
      results += items.length;
      for (const it of items) {
        const r = mapZappos(it, w);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      if (items.length < w.limit) break;
    }
  }
  // Every walk empty means the API changed or refused us — fail loudly so the
  // watchdog flags it, instead of a quiet "0 products".
  if (results === 0) throw new Error(`zappos: every sale walk returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listZappos;
