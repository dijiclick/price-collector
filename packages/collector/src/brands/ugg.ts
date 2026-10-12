/**
 * UGG — Australia (au.ugg.com), the brand's own AU store (run by Accent Group
 * on its "Velox" platform, Cloudflare in front).
 *
 * ugg.com (US/CA/GB/EU, Deckers' Salesforce site) answers every path —
 * pages, `Search-UpdateGrid`, `Coveo-Show` — with a 406 "Access Denied" to
 * GitHub runners (probe 38236399455), and its search is Coveo run server-side,
 * so there is no public key to read. Those markets are not collected here.
 *
 * au.ugg.com's own search API is an Algolia-shaped proxy on the site itself:
 * `POST /api/search/indexes/*\/queries` with `{requests:[{indexName, params}]}`
 * and index `ugg_au_prd_products`. It answers a plain browser UA from a runner
 * (probe 38236127242). One query of up to 1000 hits covers the whole discounted
 * set (113 products on 2026-10-12) — one request per run.
 *
 * Prices (AUD, major units): `price` is the selling price and `erpOriginalPrice`
 * the ERP "was" price; `isDiscounted` is the store's own flag. Kept only when
 * price < erpOriginalPrice. Badges like "30% Off At Checkout" are cart promos
 * with no strikethrough and are never read. Each hit is one colour; `variants`
 * carry per-size stock (`qty`).
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "ugg";

const SITES: Partial<Record<CountryCode, { origin: string; index: string; currency: string }>> = {
  AU: { origin: "https://au.ugg.com", index: "ugg_au_prd_products", currency: "AUD" },
};
const CAP = 1500;
const HITS = 1000;

export function queryBody(index: string, page: number): string {
  return JSON.stringify({
    requests: [
      {
        indexName: index,
        params: {
          query: "",
          hitsPerPage: HITS,
          page,
          facetFilters: ["visibleIn.searchResults:true", "isDiscounted:true"],
          attributesToHighlight: [],
        },
      },
    ],
  });
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function genderOf(h: any): ProductRecord["gender"] {
  const g = String(h?.erpGenderCode ?? "").toUpperCase();
  const demo: string[] = Array.isArray(h?.demographic) ? h.demographic.map(String) : [];
  if (/KID/.test(g) || demo.includes("Kids")) return "cocuk";
  if (g === "WOMENS" || demo.includes("Womens")) return "kadin";
  if (g === "MENS" || demo.includes("Mens")) return "erkek";
  return null;
}

function sizesOf(h: any): SizeVariant[] {
  const vars: any[] = Array.isArray(h?.variants) ? h.variants : [];
  return vars
    .filter((v) => v?.code != null && String(v.code).trim())
    .map((v) => {
      const qty = Number(v.qtyDelivery ?? v.qty ?? 0);
      return {
        label: String(v.code).trim(),
        availability: qty <= 0 ? "out_of_stock" : qty <= 2 ? "low_on_stock" : "in_stock",
      } satisfies SizeVariant;
    });
}

/** Map one search hit. Pure; null unless genuinely reduced. */
export function mapUgg(h: any, country: CountryCode = "AU"): ProductRecord | null {
  const site = SITES[country];
  if (!site || !h?.objectID || !h?.name || !h?.path) return null;
  if (h.state && h.state !== "current") return null;
  const price = num(h.price);
  const was = num(h.erpOriginalPrice);
  if (price == null || was == null || price >= was) return null;

  const imgs = ((h.images ?? []) as any[]).map((i) => (typeof i?.url === "string" ? i.url : null));
  const first = imgs.find((u): u is string => !!u) ?? null;
  const sizes = sizesOf(h);
  const inStock = h.soldOut === true ? false : sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : h.hasStockOnHand !== false;
  const colour = typeof h.colourName === "string" && h.colourName.trim() ? h.colourName.trim() : null;
  const gtins = ((h.variants ?? []) as any[]).map((v) => String(v?.gtin ?? "").trim()).filter((g) => /^\d{8,14}$/.test(g));

  return {
    brand,
    country,
    externalId: String(h.erpProductCompositeCode || h.objectID),
    name: String(h.name).trim(),
    url: `${site.origin}/${String(h.path).replace(/^\/+/, "")}`,
    imageUrl: first,
    images: cleanGallery(imgs, first),
    price: toMinor(price),
    listPrice: toMinor(was),
    currency: site.currency,
    inStock,
    barcodes: gtins.length ? [...new Set(gtins)] : null,
    category: (typeof h.shoeTypeName === "string" && h.shoeTypeName !== "Apparel & Accessories" ? h.shoeTypeName : null) ?? (typeof h.productType === "string" ? h.productType : null),
    gender: genderOf(h),
    variants: sizes.length || colour ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: typeof h.erpProductParentCode === "string" && h.erpProductParentCode ? h.erpProductParentCode.split("-")[0] : null,
    colorName: colour,
  };
}

export async function listUgg(country: CountryCode): Promise<ProductRecord[]> {
  const site = SITES[country];
  if (!site) return [];
  const byId = new Map<string, ProductRecord>();
  let hits = 0;
  for (let page = 0; page < 3 && byId.size < CAP; page++) {
    const d = await getJson<any>(`${site.origin}/api/search/indexes/*/queries`, {
      method: "POST",
      body: queryBody(site.index, page),
      headers: { "Content-Type": "application/json", Origin: site.origin, Referer: `${site.origin}/` },
      country,
      timeoutMs: 30_000,
    });
    const r = d?.data?.results?.[0];
    if (!r || r.error) throw new Error(`ugg/${country}: search answered ${JSON.stringify(d).slice(0, 160)}`);
    for (const h of r.hits ?? []) {
      hits++;
      const p = mapUgg(h, country);
      if (p && !byId.has(p.externalId)) byId.set(p.externalId, p);
    }
    if (page + 1 >= Number(r.nbPages ?? 1)) break;
  }
  const all = [...byId.values()];
  if (!all.length) throw new Error(`ugg/${country}: 0 discounted products (${hits} hits) — the feed changed shape or the sale ended`);
  return [...all.filter((p) => p.inStock), ...all.filter((p) => !p.inStock)].slice(0, CAP);
}

export const listProducts = listUgg;
