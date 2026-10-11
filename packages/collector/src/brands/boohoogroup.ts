/**
 * boohoo group UK — boohoo.com, prettylittlething.com, karenmillen.com.
 *
 * All three now run on the Debenhams Group platform (a Remix storefront), not
 * SFCC. The product lists are client-side search calls with public keys
 * that sit in the page bundle, measured 2026-10-11 from a plain request:
 *
 *  - boohoo: Bloomreach Discovery (`core.dxpapi.com`, account 7541, domain
 *    key `boohoo`). A category search on the "Womens Sale" category returns
 *    every SKU with its own `isOnStock`, `sku_size`, `sku_sale_price` and
 *    `wasPrice`, so sizes carry real availability, out-of-stock ones included.
 *  - PrettyLittleThing / Karen Millen: Algolia (`enableAlgoliaAppSeparation`,
 *    one app per fascia). Each index also carries marketplace brands, so the
 *    query is filtered to the house brand and to `discountPercentage > 0`.
 *    Hits are per colour and list only the sizes IN stock (`sizesInStock`) —
 *    the sold-out ones are not in the index at all.
 *
 * boohoo shows a near-permanent "-60%": a row is kept only when its was-price
 * is strictly above the current price, nothing else is inferred.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export type BoohooGroupSlug = "boohoo" | "prettylittlething" | "karenmillen";

const PAUSE_MS = Number(process.env.BOOHOO_PAUSE_MS ?? 700);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AlgoliaSite {
  site: string;
  appId: string;
  key: string;
  index: string;
  /** The house brand as Algolia spells it; the index also sells other brands. */
  brandFacet: string;
}

/** Public search-only keys from the storefront bundle (2026-10-11). */
export const BOOHOO_ALGOLIA: Record<Exclude<BoohooGroupSlug, "boohoo">, AlgoliaSite> = {
  prettylittlething: {
    site: "https://www.prettylittlething.com",
    appId: "PBL6WQH9VL",
    key: "aca5366ccc1a1abd3118258c97c7322f",
    index: "prettylittlething-dbz-prod",
    brandFacet: "PrettyLittleThing",
  },
  karenmillen: {
    site: "https://www.karenmillen.com",
    appId: "SYQZESK6ZL",
    key: "419d9334b83437ccffbc67e4636e9a01",
    index: "karenmillen-dbz-prod",
    brandFacet: "KarenMillen",
  },
};

const BOOHOO_SITE = "https://www.boohoo.com";
const BR_ENDPOINT = "https://core.dxpapi.com/api/v1/core/";
const BR_ACCOUNT = 7541;
const BR_DOMAIN = "boohoo";
/** "Womens Sale" (`/categories/womens-sale`); re-read from the page loader each run. */
const BOOHOO_SALE_CATEGORY = "65c11236035e287e84b9699e";
const BR_FL = [
  "pid", "title", "brand", "url", "thumb_image", "price", "sale_price", "gender",
  "categoryTaxonomy", "styleTaxonomy", "colour", "skuid", "sku_size", "sku_price",
  "sku_sale_price", "wasPrice", "isOnStock", "sku_thumb_images",
].join(",");

function genderOf(g: unknown): ProductRecord["gender"] {
  const s = String(Array.isArray(g) ? g[0] : g ?? "").toLowerCase();
  if (s === "female") return "kadin";
  if (s === "male") return "erkek";
  if (/kid|child|girl|boy/.test(s)) return "cocuk";
  return null;
}

const first = (v: unknown): any => (Array.isArray(v) ? v[0] : v);
const num = (v: unknown): number => Number(first(v));

/** boohoo's doc url pins a size (`?colour=black&size=20`); keep the colour only. */
export function boohooUrl(raw: string): string {
  try {
    const u = new URL(raw, BOOHOO_SITE);
    u.searchParams.delete("size");
    return u.toString();
  } catch {
    return raw;
  }
}

/** One Bloomreach doc → record. Pure. Prices are major-unit numbers. */
export function mapBloomreachDoc(doc: any, country: CountryCode = "GB"): ProductRecord | null {
  const price = Number(doc?.sale_price ?? doc?.price);
  if (!doc?.pid || !doc?.title || !Number.isFinite(price) || price <= 0) return null;
  const vs: any[] = Array.isArray(doc.variants) ? doc.variants : [];
  // The was-price of the SKUs sold at the card price; failing that, the highest one.
  const atPrice = vs.filter((v) => num(v.sku_sale_price) === price).map((v) => num(v.wasPrice));
  const anyWas = vs.map((v) => num(v.wasPrice));
  const was = Math.max(...(atPrice.filter(Number.isFinite).length ? atPrice : anyWas).filter(Number.isFinite), 0);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of vs) {
    const label = String(v?.sku_size ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: String(first(v.isOnStock)) === "true" ? "in_stock" : "out_of_stock" });
  }
  const colors = [...new Set(vs.map((v) => String(first(v.colour) ?? "").trim()).filter(Boolean))];
  const imgs = [doc.thumb_image, ...vs.flatMap((v) => v.sku_thumb_images ?? [])].filter((u) => typeof u === "string");
  const inStock = vs.length ? vs.some((v) => String(first(v.isOnStock)) === "true") : true;
  return {
    brand: "boohoo",
    country,
    externalId: String(doc.pid),
    name: String(doc.title).trim(),
    url: boohooUrl(String(doc.url ?? `${BOOHOO_SITE}/product/${String(doc.pid).toLowerCase()}`)),
    imageUrl: imgs[0] ?? null,
    images: cleanGallery(imgs, imgs[0] ?? null),
    price: toMinor(price),
    listPrice: was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock,
    category: first(doc.styleTaxonomy) ?? first(doc.categoryTaxonomy) ?? null,
    gender: genderOf(doc.gender) ?? "kadin",
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

/** One Algolia hit (PLT / Karen Millen) → record. Pure. */
export function mapDbzHit(slug: Exclude<BoohooGroupSlug, "boohoo">, hit: any, country: CountryCode = "GB"): ProductRecord | null {
  const cfg = BOOHOO_ALGOLIA[slug];
  const price = Number(hit?.price);
  const was = Number(hit?.wasPrice);
  if (!hit?.objectID || !hit?.name || !hit?.slug || !Number.isFinite(price) || price <= 0) return null;
  const colour = String(hit.colour ?? "").trim();
  const cv = (hit.colourVariants ?? []).find((c: any) => String(c?.colour ?? "") === colour) ?? hit.colourVariants?.[0];
  const inSizes: string[] = (cv?.sizesInStock ?? hit.sizes ?? []).map((s: unknown) => String(s).trim()).filter(Boolean);
  const sizes: SizeVariant[] = [...new Set(inSizes)].map((label) => ({ label, availability: "in_stock" as const }));
  const imgs: string[] = (hit.images ?? []).filter((u: unknown) => typeof u === "string");
  const lead = imgs[0] ?? cv?.image ?? null;
  const url = `${cfg.site}/product/${hit.slug}${colour ? `?colour=${encodeURIComponent(colour)}` : ""}`;
  return {
    brand: slug,
    country,
    externalId: String(hit.objectID),
    name: String(hit.name).replace(/\s+/g, " ").trim(),
    url,
    imageUrl: lead,
    images: cleanGallery(imgs, lead),
    price: toMinor(price),
    listPrice: Number.isFinite(was) && was > price ? toMinor(was) : null,
    currency: COUNTRIES[country].currency,
    inStock: hit.isOnStock !== false && (sizes.length > 0 || hit.isOnStock === true),
    category: hit.styleTaxonomy ?? hit.categoryTaxonomy ?? null,
    gender: genderOf(hit.gender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: hit.productKey ? `${slug}:${hit.productKey}` : null,
    colorName: colour || null,
  };
}

async function boohooSaleCategory(): Promise<string> {
  const route = encodeURIComponent("routes/($locale)/categories/$");
  const data = await getJson<any>(`${BOOHOO_SITE}/categories/womens-sale?_data=${route}`, { country: "GB", retries: 1 }).catch(() => null);
  const id = data?.categoryData?.id;
  return typeof id === "string" && /^[0-9a-f]{24}$/.test(id) ? id : BOOHOO_SALE_CATEGORY;
}

async function listBoohoo(country: CountryCode, cap: number): Promise<ProductRecord[]> {
  const cat = await boohooSaleCategory();
  const rows = 200;
  const byId = new Map<string, ProductRecord>();
  const maxPages = Math.ceil((cap * 1.4) / rows);
  for (let p = 0; p < maxPages; p++) {
    if (p > 0) await sleep(PAUSE_MS);
    const q = new URLSearchParams({
      account_id: String(BR_ACCOUNT),
      domain_key: BR_DOMAIN,
      request_type: "search",
      search_type: "category",
      q: cat,
      fl: BR_FL,
      rows: String(rows),
      start: String(p * rows),
      url: `${BOOHOO_SITE}/categories/womens-sale`,
      _br_uid_2: "defaultCookieId",
      fq: 'isOnStock:"true"',
    });
    const data = await getJson<any>(`${BR_ENDPOINT}?${q}`, { country });
    const docs: any[] = data?.response?.docs ?? [];
    for (const d of docs) {
      // The sale category also lists group brands sold on boohoo.com (PLT has its own adapter).
      if (d?.brand && !/^(boohoo|dsgn studio)/i.test(String(d.brand))) continue;
      const r = mapBloomreachDoc(d, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
    if (docs.length < rows || byId.size >= cap) break;
  }
  return [...byId.values()];
}

/**
 * Discount bands, deepest first. Some indexes cap pagination at 1,000 hits
 * (Karen Millen's does: 5,088 matches, `nbPages` 1), so one query cannot reach
 * the cap — each band is its own query and pages on its own.
 */
const DISCOUNT_BANDS = ["discountPercentage >= 60", "discountPercentage:40 TO 59", "discountPercentage:1 TO 39"];

async function listAlgolia(slug: Exclude<BoohooGroupSlug, "boohoo">, country: CountryCode, cap: number): Promise<ProductRecord[]> {
  const cfg = BOOHOO_ALGOLIA[slug];
  const hitsPerPage = 1000;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const band of DISCOUNT_BANDS) {
    for (let page = 0; page < 5 && byId.size < cap; page++) {
      if (calls++ > 0) await sleep(PAUSE_MS);
      const data = await getJson<any>(`https://${cfg.appId}-dsn.algolia.net/1/indexes/${cfg.index}/query`, {
        method: "POST",
        country,
        headers: { "X-Algolia-Application-Id": cfg.appId, "X-Algolia-API-Key": cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "",
          page,
          hitsPerPage,
          filters: `brand:"${cfg.brandFacet}" AND ${band}`,
          attributesToRetrieve: [
            "objectID", "name", "slug", "price", "wasPrice", "colour", "colourVariants", "sizes", "images",
            "isOnStock", "gender", "styleTaxonomy", "categoryTaxonomy", "productKey",
          ],
          attributesToHighlight: [],
        }),
      });
      const hits: any[] = data?.hits ?? [];
      for (const h of hits) {
        const r = mapDbzHit(slug, h, country);
        if (r && r.listPrice != null) byId.set(r.externalId, r);
      }
      if (hits.length < hitsPerPage || page + 1 >= (data?.nbPages ?? 0)) break;
    }
    if (byId.size >= cap) break;
  }
  return [...byId.values()];
}

/** Register as `listBoohooGroup("boohoo" | "prettylittlething" | "karenmillen", country)`. GB only. */
export async function listBoohooGroup(slug: BoohooGroupSlug, country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "GB") return [];
  const cap = 1500;
  const all = slug === "boohoo" ? await listBoohoo(country, cap) : await listAlgolia(slug, country, cap);
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, cap);
}
