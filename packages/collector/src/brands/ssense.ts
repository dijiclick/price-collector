/**
 * SSENSE (ssense.com/en-ca) — luxury multi-brand, Montréal; collected for Canada (CAD).
 *
 * The website and its `.json` listing paths sit behind a Cloudflare challenge
 * that GitHub runners never pass. The Android app (`ssense.android.prod`
 * 4.6.1, React Native) talks to its own GraphQL federation,
 * `constellation.ssense.com/graphql`, which only checks an
 * `x-client-version` header (no key, no login) — the same `getProducts`
 * operation the app's product grid sends (`connectedProducts`, Hermes bundle).
 *
 * `where.salePrice > 0` is the app's sale filter; `priceByCountry(CA)` gives
 * `regularPrice` and `lowestPrice(discountNames: [])`, i.e. the PUBLIC lowest
 * price — private-sale tags are deliberately not sent, so no member price
 * leaks in. Prices are whole CAD dollars. A row needs `lowestPrice.source` to
 * be a markdown and below the regular price. `variants[].stock` is per size.
 *
 * Women's sale first (~5,100 styles; newest positions first), then men's, 100
 * a page, ≤ 15 requests.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import type { CountryCode } from "../../../../lib/countries";

export const brand = "ssense";

export const API = "https://constellation.ssense.com/graphql";
export const CLIENT_VERSION = "4.6.1";
const SITE = "https://www.ssense.com/en-ca";
const PAGE = 100;
const CAP = 1500;
const IMG = "c_scale,h_960/f_auto,q_auto";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Walk {
  gender: "women" | "men";
  max: number;
}
export const WALKS: Walk[] = [
  { gender: "women", max: 1100 },
  { gender: "men", max: 400 },
];

export const QUERY = `query getProducts($after: String = "", $country: String!, $first: Int!, $languageSelector: [String!] = ["en"], $where: [ProductFilterInput!] = [], $with: ProductOptionInput!) {
  products: connectedProducts(after: $after, first: $first, where: $where, with: $with) {
    edges { node {
      id images productCode gender
      name: nameByLanguage(lang: $languageSelector)
      brand: newBrand { id name(lang: $languageSelector) seoKeyword }
      category: newCategory { id name(lang: $languageSelector) }
      variants { sku stock size(country: $country) { name } }
      price: priceByCountry(country: [$country]) { currency regularPrice lowestPrice(discountNames: []) }
    } }
    pageInfo { hasNextPage endCursor }
    paginationInfo { total: totalProducts }
  }
}`;

export function requestBody(w: Walk, after: string): string {
  const where = [
    {
      inStock: { equals: "true" },
      displayable: { equals: "true" },
      channel: { equals: "website" },
      regularPrice: { gt: 0 },
      salePrice: { gt: 0 },
      listableCountry: { in: ["CA"] },
      gender: { equals: w.gender },
    },
  ];
  return JSON.stringify({ query: QUERY, variables: { after, country: "CA", first: PAGE, where, with: { country: "CA", lang: "en" } } });
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const en = (v: any): string => String((v && typeof v === "object" ? v.en : v) ?? "").trim();
const img = (u: unknown): string | null => (typeof u === "string" && u.startsWith("https://") ? u.replace("__IMAGE_PARAMS__", IMG) : null);

/** Map one product node. Pure; null unless a public markdown below the regular price. */
export function mapSsense(n: any): ProductRecord | null {
  const id = String(n?.id ?? "").trim();
  const title = en(n?.name);
  if (!id || !title) return null;
  const pr = (Array.isArray(n?.price) ? n.price : []).find((p: any) => p?.currency === "CAD");
  const regular = Math.round(Number(pr?.regularPrice) * 100);
  const low = pr?.lowestPrice;
  const price = Math.round(Number(low?.amount) * 100);
  if (!(regular > 0) || !(price > 0) || !(price < regular) || low?.source !== "markdown") return null;

  const make = en(n?.brand?.name);
  const gender = n?.gender === "women" ? "kadin" : n?.gender === "men" ? "erkek" : null;
  const section = n?.gender === "men" ? "men" : "women";
  const brandSlug = en(n?.brand?.seoKeyword) || slug(make);
  const sizes: SizeVariant[] = (Array.isArray(n?.variants) ? n.variants : [])
    .filter((v: any) => v?.size?.name)
    .map((v: any) => ({ label: String(v.size.name), availability: Number(v.stock) > 0 ? (Number(v.stock) <= 1 ? "low_on_stock" : "in_stock") : "out_of_stock" }));
  const photos = (Array.isArray(n?.images) ? n.images : []).map(img).filter((u: string | null): u is string => !!u);
  const category = en(n?.category?.name).toLowerCase() || null;

  return {
    brand,
    country: "CA",
    externalId: id,
    name: make && !title.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${title}` : title,
    url: `${SITE}/${section}/product/${brandSlug}/${slug(title)}/${id}`,
    imageUrl: photos[0] ?? null,
    images: cleanGallery(photos, photos[0]),
    price,
    listPrice: regular,
    currency: "CAD",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : true,
    category,
    gender,
    variants: sizes.length ? { colors: [], sizes } : null,
    groupKey: null,
    colorName: null,
  };
}

export async function listSsense(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "CA") return [];
  const byId = new Map<string, ProductRecord>();
  let seen = 0;
  const problems: string[] = [];
  for (const w of WALKS) {
    let after = "";
    let taken = 0;
    while (taken < w.max && byId.size < CAP) {
      if (seen > 0) await sleep(500);
      const data = await getJson<any>(API, {
        country,
        method: "POST",
        body: requestBody(w, after),
        headers: { "content-type": "application/json", "x-client-version": CLIENT_VERSION },
        retries: 1,
        timeoutMs: 45_000,
      }).catch((e) => {
        problems.push(`${w.gender}: ${String(e).slice(0, 120)}`);
        return null;
      });
      const edges: any[] = data?.data?.products?.edges ?? [];
      seen += edges.length;
      for (const e of edges) {
        const r = mapSsense(e?.node);
        if (r && !byId.has(r.externalId)) {
          byId.set(r.externalId, r);
          taken++;
        }
      }
      const info = data?.data?.products?.pageInfo;
      if (!edges.length || !info?.hasNextPage || !info?.endCursor) break;
      after = String(info.endCursor);
    }
  }
  if (seen === 0) throw new Error(`ssense: every sale page returned no products (${problems.slice(0, 3).join("; ")})`);
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}

export const listProducts = listSsense;
