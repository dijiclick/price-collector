/**
 * Italian Shopify storefronts (2026-10-21): Benetton, Sisley, Terranova,
 * Calliope, Yamamay, Carpisa — Italy, EUR.
 *
 * Each store's own `/products.json` (Shopify's public catalogue JSON, per
 * variant `price` / `compare_at_price` / `available`), read on the storefront
 * domain. No proxy: every route answered a GitHub runner directly (probe run
 * 39635106148) and each `/meta.json` reports `currency: EUR`, country IT.
 *
 * - The feed is read in ENGLISH where the shop publishes a translation
 *   (`/en`, `/en-it` — same market, same prices) so names and product types
 *   classify; Terranova and Calliope are Italian-only, so their Italian
 *   `product_type` is translated here (TEDDY_TYPES). Product links always go
 *   to the Italian storefront: handles ARE translated, but Shopify redirects
 *   an English handle there to the Italian page (checked on Benetton, Sisley,
 *   Yamamay: 200 after the redirect; Carpisa's handles are identical).
 * - `compare_at_price > price` is the shop's own strike price (the PDPs show
 *   it struck, with the Omnibus 30-day line). Equal values (Benetton sets
 *   compare = price on full-price items) are not a deal.
 * - Terranova and Calliope mark most of their range down (61% / 73% of
 *   products on 2026-10-21 — a strike price on the PDP, not the whole
 *   catalogue), so the walk stops once the in-stock cap is filled.
 *
 * Every page that fails throws (a short list would be swept as sold out), and
 * so does running out of the page budget before the catalogue ends.
 */
import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { mapShopify, marketHeaders, type ShopifyStore } from "./_shopify";
import type { CountryCode } from "../../../../lib/countries";

export interface ItalyShop {
  brand: string;
  /** Where products.json is read (English locale when the shop has one). */
  dataSite: string;
  /** Italian storefront used for product links. */
  linkSite: string;
  /** Gender for rows with no signal (women-only labels). */
  defaultGender?: ProductRecord["gender"];
  /** How this shop says who a product is for. */
  genderBy: "tags" | "sizes" | "title";
  /** Translate an Italian `product_type` (Teddy brands). */
  translateType?: boolean;
}

export const ITALY_SHOPS: Record<string, ItalyShop> = {
  benetton: { brand: "benetton", dataSite: "https://it.benetton.com/en", linkSite: "https://it.benetton.com", genderBy: "sizes" },
  sisley: { brand: "sisley", dataSite: "https://it.sisley.com/en", linkSite: "https://it.sisley.com", genderBy: "title" },
  terranova: { brand: "terranova", dataSite: "https://www.terranovastyle.com/it-it", linkSite: "https://www.terranovastyle.com/it-it", genderBy: "tags", translateType: true },
  calliope: { brand: "calliope", dataSite: "https://www.calliope.style/it-it", linkSite: "https://www.calliope.style/it-it", genderBy: "tags", translateType: true, defaultGender: "kadin" },
  yamamay: { brand: "yamamay", dataSite: "https://www.yamamay.com/en-it", linkSite: "https://www.yamamay.com/it-it", genderBy: "title", defaultGender: "kadin" },
  carpisa: { brand: "carpisa", dataSite: "https://www.carpisa.it/en-it", linkSite: "https://www.carpisa.it/it-it", genderBy: "title", defaultGender: "kadin" },
};

const CAP = 1500;
const MAX_PAGES = Number(process.env.ITALY_SHOPIFY_MAX_PAGES ?? 45);
const PAUSE_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Terranova/Calliope `product_type` → English type text the classifier reads. */
export const TEDDY_TYPES: Record<string, string> = {
  "t-shirt mc": "T-shirt", "t-shirt ml": "Long sleeve T-shirt", "pantalone lungo": "Trousers", maglia: "Sweater",
  capospalla: "Coat", felpa: "Sweatshirt", "canotta/top": "Top", "camicia ml": "Shirt", "camicia mc": "Short sleeve shirt",
  cappellino: "Cap", "pantalone ginnico lungo": "Joggers", "pantalone ginnico corto": "Sports shorts", abito: "Dress",
  gonna: "Skirt", "pantalone jeans lungo": "Jeans", "pantalone jeans corto": "Denim shorts", giacca: "Jacket",
  "sciarpe/foulard": "Scarf", "pantalone corto": "Shorts", calzature: "Shoes", "slip mare": "Bikini bottoms",
  calzetteria: "Socks", pigiama: "Pyjamas", slip: "Briefs", cintura: "Belt", "accessori vari": "Accessories",
  "leggings lungo": "Leggings", "leggings corto": "Cycling shorts", reggiseno: "Bra", "reggiseno mare": "Bikini top",
  guanti: "Gloves", intimo: "Underwear", "costume intero": "Swimsuit", portafogli: "Wallet", body: "Bodysuit",
  borsa: "Bag", cosmetica: "Cosmetics",
};

export const translateTeddyType = (t: unknown): string | null => {
  const k = String(t ?? "").trim().toLowerCase();
  return k ? TEDDY_TYPES[k] ?? null : null;
};

const tagList = (p: any): string[] =>
  Array.isArray(p?.tags) ? p.tags.map(String) : typeof p?.tags === "string" ? p.tags.split(",").map((s: string) => s.trim()) : [];

/** Terranova/Calliope tag the section in Italian: Donna / Uomo / Bambina / Bambino. Pure. */
export function genderFromTags(p: any): ProductRecord["gender"] | undefined {
  const t = tagList(p).map((s) => s.toLowerCase());
  if (t.some((s) => /^(bambin[ao]|kids?|neonat[ao])$/.test(s))) return "cocuk";
  if (t.includes("donna")) return "kadin";
  if (t.includes("uomo")) return "erkek";
  return undefined;
}

/**
 * Benetton has no tags or types; its kids' sizes are heights in cm (50–176)
 * or age ranges ("3-4", "5-8"), its adults' letters or 36–60. Kids only when
 * every size reads as a child's. Pure.
 */
export function genderFromSizes(sizes: string[]): ProductRecord["gender"] | undefined {
  const s = sizes.map((x) => x.trim()).filter(Boolean);
  if (!s.length) return undefined;
  const nums = s.map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  if (nums.every(Number.isFinite) && Math.min(...nums) >= 50 && Math.max(...nums) >= 62) return "cocuk";
  if (s.every((x) => /^\d{1,2}-\d{1,2}$/.test(x) && Number(x.split("-")[1]) <= 14)) return "cocuk";
  return undefined;
}

const isReduced = (v: any): boolean => {
  const price = parseFloat(v?.price);
  const cmp = parseFloat(v?.compare_at_price);
  return Number.isFinite(price) && price > 0 && Number.isFinite(cmp) && cmp > price;
};

/** Italian option names (`Taglia`, `Misura`) — `_shopify.ts` only knows English/Turkish ones. */
function italianSizes(p: any, variants: any[]): SizeVariant[] {
  const opts: any[] = p?.options ?? [];
  const i = opts.findIndex((o) => /^(taglia|misura|size)$/i.test(String(typeof o === "string" ? o : o?.name ?? "").trim()));
  if (i < 0) return [];
  const key = `option${i + 1}`;
  const seen = new Set<string>();
  const out: SizeVariant[] = [];
  for (const v of variants) {
    const label = String(v?.[key] ?? "").trim();
    if (!label || /default title/i.test(label) || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: v?.available ? "in_stock" : "out_of_stock" });
  }
  return out;
}

/**
 * Map one products.json product (reduced rows only). Pure.
 *
 * A product whose colours are not all marked down (Carpisa: one colour of a
 * bag at −30%) is priced from its REDUCED variants only — the price and the
 * strike price then belong to the same variant, never a mix.
 */
export function mapItalyShopify(shop: ItalyShop, country: CountryCode, p: any): ProductRecord | null {
  const store: ShopifyStore = { brand: shop.brand, sites: { [country]: shop.linkSite }, defaultGender: shop.defaultGender ?? null };
  const all: any[] = Array.isArray(p?.variants) ? p.variants : [];
  const reduced = all.filter(isReduced);
  if (!reduced.length) return null;
  const subset = reduced.length === all.length ? p : { ...p, variants: reduced };
  const r = mapShopify(store, country, shop.linkSite, subset);
  if (!r || r.listPrice == null || r.listPrice <= r.price) return null;
  let sizes: SizeVariant[] = r.variants?.sizes ?? [];
  if (!sizes.length) {
    const it = italianSizes(p, subset.variants);
    if (it.length) {
      sizes = it;
      r.variants = { colors: r.variants?.colors ?? [], sizes };
    }
  }
  let gender: ProductRecord["gender"] | undefined;
  if (shop.genderBy === "tags") gender = genderFromTags(p);
  else if (shop.genderBy === "sizes") gender = genderFromSizes(sizes.map((x) => x.label));
  const category = shop.translateType ? translateTeddyType(p?.product_type) : r.category ?? null;
  return { ...r, gender: gender ?? r.gender ?? shop.defaultGender ?? null, category };
}

export const pageUrl = (shop: ItalyShop, n: number): string => `${shop.dataSite}/products.json?limit=250&page=${n}`;

async function page(shop: ItalyShop, n: number, country: CountryCode): Promise<any[]> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = await getJson<any>(pageUrl(shop, n), {
        retries: 0,
        country,
        timeoutMs: 60_000,
        headers: { ...marketHeaders(country), "Accept-Language": "it-IT,it;q=0.9,en;q=0.8" },
      });
      if (Array.isArray(d?.products)) return d.products;
      last = new Error("no products array");
    } catch (e) {
      last = e;
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`${shop.brand}/${country}: products.json page ${n} failed: ${String(last)}`);
}

/** Register as `(c) => listItalyShopify("benetton", c)` etc. IT only. */
export async function listItalyShopify(brand: string, country: CountryCode): Promise<ProductRecord[]> {
  const shop = ITALY_SHOPS[brand];
  if (!shop || country !== "IT") return [];
  const byId = new Map<string, ProductRecord>();
  let inStock = 0;
  let finished = false;
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(PAUSE_MS);
    const rows = await page(shop, n, country);
    if (rows.length === 0) {
      finished = true;
      break;
    }
    for (const p of rows) {
      const r = mapItalyShopify(shop, country, p);
      if (!r || byId.has(r.externalId)) continue;
      byId.set(r.externalId, r);
      if (r.inStock) inStock++;
    }
    if (inStock >= CAP || rows.length < 250) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error(`${brand}/${country}: page budget (${MAX_PAGES}) ran out before the catalogue ended`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
