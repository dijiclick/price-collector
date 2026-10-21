/**
 * SCAYLE storefronts (Nuxt "storefront-application"): s.Oliver and TOM TAILOR
 * in Germany (2026-10-21).
 *
 * Every SCAYLE storefront exposes its own server's RPC bridge,
 * `POST <site>/api/rpc/<method>` with `{ payload }` — the exact call the
 * product grid makes in the shopper's browser. `getProductsByCategory`
 * returns a page of products with per-size stock, EANs and prices in cents
 * (`withTax`, and `beforeSaleWithTax` when SCAYLE has a sale reduction on it).
 * No key, no cookie: the shop is picked by the `x-shop-id` header (s.Oliver
 * also maps it from the domain). Both answer a GitHub runner 200 (probe runs
 * 39613147946 and 39613942935, 2026-10-21).
 *
 * The `with` projection keeps a page of 100 at ~0.9 MB raw / ~100 KB gzip;
 * without it a page is ~5 MB. The RPC caps `perPage` at 100.
 *
 * Collected: the shop's women's and men's SALE categories (kids skipped),
 * reduced rows only (`beforeSaleWithTax` > price — SCAYLE's own sale
 * reduction, the price the shop struck through; EU Omnibus applies), in-stock
 * first, capped. Gender comes from which tree the row was found in.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export type ScayleSlug = "soliver" | "tomtailor";

export interface ScayleShop {
  slug: ScayleSlug;
  /** Storefront origin; the RPC lives at `${origin}/api/rpc`. */
  origin: string;
  /** Path prefix of product pages (TOM TAILOR runs every locale under `/de`). */
  pagePrefix: string;
  /**
   * What ends a product URL: s.Oliver routes `/p/<slug>-<id>`, TOM TAILOR
   * `/de/p/<slug>-<referenceKey>` (e.g. `-1042510_10899`). The slug itself is
   * ignored by both (probe run 39615070664: `/de/p/x-1042510_10899` → 200).
   */
  urlKey: "id" | "referenceKey";
  shopId: number;
  /** Sale categories and the gender of everything under each. */
  sale: { id: number; gender: "kadin" | "erkek"; pages: number }[];
  /** Product-level attribute keys to fetch. */
  attributes: string[];
  /** Attribute keys (in order) that hold the product type, e.g. "Kleid". */
  typeKeys: string[];
  /** Attribute keys (in order) that hold the colour name. */
  colorKeys: string[];
  /** Turn an image URL from the API into one the app should load. */
  image?: (url: string) => string;
}

export const SCAYLE_SHOPS: Record<ScayleSlug, Partial<Record<CountryCode, ScayleShop>>> = {
  soliver: {
    DE: {
      slug: "soliver",
      origin: "https://www.soliver.de",
      pagePrefix: "",
      urlKey: "id",
      shopId: 10014,
      // /damen/sale ~5.5k, /herren/sale ~2k (getCategoryByPath, 2026-10-21).
      sale: [
        { id: 641, gender: "kadin", pages: 10 },
        { id: 452, gender: "erkek", pages: 6 },
      ],
      attributes: ["name", "brand", "classDigiCore20", "mainClassDigiCore20", "colorBase"],
      typeKeys: ["classDigiCore20", "mainClassDigiCore20"],
      colorKeys: ["colorBase"],
      // Amplience: the bare URL is a ~1 MB original; `w`/`fmt` give a ~30 KB JPEG.
      image: (u) => (u.includes("media.soliver.com") && !u.includes("?") ? `${u}?w=800&fmt=jpg` : u),
    },
  },
  tomtailor: {
    DE: {
      slug: "tomtailor",
      origin: "https://www.tom-tailor.de",
      pagePrefix: "/de",
      urlKey: "referenceKey",
      shopId: 1501,
      // /de/c/damen/sale/10 ~1.2k, /de/c/herren/sale/1809.
      sale: [
        { id: 10, gender: "kadin", pages: 10 },
        { id: 1809, gender: "erkek", pages: 6 },
      ],
      attributes: ["name", "brand", "subGroupNameMappedGenericArticle", "produktgruppe", "suchFarbeTTShopFarbname", "color"],
      typeKeys: ["subGroupNameMappedGenericArticle", "produktgruppe"],
      colorKeys: ["color", "suchFarbeTTShopFarbname"],
    },
  },
};

const PER_PAGE = 100; // the RPC's ceiling
const CAP = 1500;
const PAUSE_MS = Number(process.env.SCAYLE_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The request body for one page — `with` is what keeps a page small. */
export function rpcBody(shop: ScayleShop, categoryId: number, page: number): string {
  return JSON.stringify({
    payload: {
      categoryId,
      page,
      perPage: PER_PAGE,
      with: {
        attributes: { withKey: shop.attributes },
        variants: { attributes: { withKey: ["size", "ean"] }, lowestPriorPrice: true },
        images: { attributes: { withKey: ["imageType"] } },
        priceRange: true,
        lowestPriorPrice: true,
      },
    },
  });
}

const one = (a: any): any => (Array.isArray(a?.values) ? a.values[0] : a?.values);
const label = (attrs: any, keys: string[]): string | null => {
  for (const k of keys) {
    const v = String(one(attrs?.[k])?.label ?? "").trim();
    if (v) return v;
  }
  return null;
};

/** "Kleid mit Wasserfall-Ausschnitt" → "kleid-mit-wasserfall-ausschnitt" (the storefront ignores the slug; the id routes). */
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Per-size stock. ≤ 3 left reads as low stock, like the other SCAYLE adapters' feeds. */
export function sizesOf(p: any): SizeVariant[] {
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(p?.variants) ? p.variants : []) {
    const size = String(one(v?.attributes?.size)?.label ?? "").trim();
    if (!size || seen.has(size)) continue;
    seen.add(size);
    const q = Number(v?.stock?.quantity ?? 0);
    const sellable = v?.stock?.isSellableWithoutStock === true;
    out.push({ label: size, availability: q > 3 || sellable ? "in_stock" : q > 0 ? "low_on_stock" : "out_of_stock" });
  }
  return out;
}

/** Map one product. Pure. Null unless SCAYLE itself has it reduced. */
export function mapScayle(shop: ScayleShop, country: CountryCode, p: any, gender: ProductRecord["gender"]): ProductRecord | null {
  if (!p?.id || p.isActive === false) return null;
  const key = shop.urlKey === "id" ? String(p.id) : String(p.referenceKey ?? "");
  if (!key) return null;
  const min = p.priceRange?.min ?? p.variants?.[0]?.price;
  const price = Number(min?.withTax);
  if (!Number.isFinite(price) || price <= 0) return null;
  const before = Number(min?.beforeSaleWithTax);
  if (!Number.isFinite(before) || before <= price) return null;
  // EU Omnibus: when SCAYLE knows the lowest price of the last 30 days, that is
  // the honest reference — and a row already this cheap within 30 days is not
  // a fresh markdown. Most rows carry none (s.Oliver 2026-10-21: 90 of 100).
  const low = Number(p.lowestPriorPrice?.withTax);
  if (Number.isFinite(low) && low > 0 && low <= price) return null;
  const was = Number.isFinite(low) && low > price && low < before ? low : before;
  const name = label(p.attributes, ["name"]);
  if (!name) return null;

  const imgs = (Array.isArray(p.images) ? p.images : [])
    .map((im: any) => (typeof im?.url === "string" ? im.url : null))
    // s.Oliver lists each shot twice, `_front` and `_frontfs` (full-screen crop).
    .filter((u: string | null): u is string => !!u && !/fs$/.test(u))
    .map((u: string) => (shop.image ? shop.image(u) : u));
  // A model/front shot first when there is one, rather than a flat lay.
  const lead = imgs.find((u: string) => /_front\b|_front\?/.test(u)) ?? imgs[0] ?? null;

  const sizes = sizesOf(p);
  const barcodes = [
    ...new Set<string>(
      (Array.isArray(p.variants) ? p.variants : [])
        .map((v: any) => String(one(v?.attributes?.ean)?.value ?? ""))
        .filter((e: string) => /^\d{8,14}$/.test(e)),
    ),
  ];
  const inStock = p.isSoldOut !== true && (sizes.length === 0 || sizes.some((s) => s.availability !== "out_of_stock"));
  const color = label(p.attributes, shop.colorKeys);

  return {
    brand: shop.slug,
    country,
    externalId: String(p.id),
    name,
    url: `${shop.origin}${shop.pagePrefix}/p/${slugify(name) || "p"}-${key}`,
    imageUrl: lead,
    images: cleanGallery(imgs, lead),
    price,
    listPrice: was,
    currency: String(min?.currencyCode ?? "EUR"),
    inStock,
    barcodes: barcodes.length ? barcodes : null,
    category: label(p.attributes, shop.typeKeys),
    gender,
    variants: sizes.length ? { colors: color ? [color] : [], sizes } : null,
    groupKey: p.masterKey ? `${shop.slug}:${p.masterKey}` : null,
    colorName: color,
  };
}

export async function listScayle(slug: ScayleSlug, country: CountryCode): Promise<ProductRecord[]> {
  const shop = SCAYLE_SHOPS[slug]?.[country];
  if (!shop) return [];
  const url = `${shop.origin}/api/rpc/getProductsByCategory`;
  const byId = new Map<string, ProductRecord>();
  let calls = 0;
  for (const cat of shop.sale) {
    for (let page = 1; page <= cat.pages; page++) {
      if (calls++) await sleep(PAUSE_MS);
      let data: any;
      try {
        data = await getJson<any>(url, {
          country,
          method: "POST",
          headers: { "content-type": "application/json", "x-shop-id": String(shop.shopId) },
          body: rpcBody(shop, cat.id, page),
          retries: 2,
          timeoutMs: 45_000,
        });
      } catch (err) {
        // The first page of the first tree failing means the route is down: throw
        // (the stored rows stay). A later page failing just ends that tree.
        if (byId.size === 0 && page === 1) throw err;
        break;
      }
      const rows: any[] = Array.isArray(data?.products) ? data.products : [];
      for (const p of rows) {
        const r = mapScayle(shop, country, p, cat.gender);
        if (r && !byId.has(r.externalId)) byId.set(r.externalId, r);
      }
      const last = Number(data?.pagination?.last ?? 0);
      if (!rows.length || page >= last) break;
    }
  }
  const all = [...byId.values()];
  const out = [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
  console.log(`${slug}/${country}: ${calls} pages, ${all.length} reduced, kept ${out.length}`);
  return out;
}
