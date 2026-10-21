/**
 * Ajmal Perfumes — two different platforms per market, measured 2026-10-11:
 *
 * - UAE (en-ae.ajmal.com): Magento PWA. Its public GraphQL (`/graphql`, GET)
 *   answers `products(filter:{price:{from:"0"}})` for the whole catalogue
 *   (~530 items, 3 pages of 200) with `price_range.minimum_price`
 *   `regular_price` / `final_price` in AED and configurable `variants`
 *   (sizes such as 50GM / 100ML with their own `stock_status`).
 * - KSA (sa.ajmal.com): a Shopify store (`/meta.json` currency SAR). The
 *   `/en` market path gives English titles (the bare host is Arabic), so the
 *   shared Shopify walker runs on `https://sa.ajmal.com/en`.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { listShopify } from "./_shopify";

const AE_SITE = "https://en-ae.ajmal.com";
const SA_STORE = { brand: "ajmal", sites: { SA: "https://sa.ajmal.com/en" } };
const PAGE_SIZE = 200;
const MAX_PAGES = 10;

export const AJMAL_QUERY = `query($page:Int!){products(filter:{price:{from:"0"}},pageSize:${PAGE_SIZE},currentPage:$page){
total_count page_info{total_pages}
items{__typename sku name url_key url_suffix stock_status small_image{url}
media_gallery{url disabled position}
price_range{minimum_price{regular_price{value currency} final_price{value currency}}}
... on ConfigurableProduct{variants{attributes{code label} product{stock_status}}}}}}`;

function genderOf(name: string): ProductRecord["gender"] {
  if (/\bunisex\b/i.test(name)) return null;
  if (/\b(for )?(women|her)\b/i.test(name)) return "kadin";
  if (/\b(for )?(men|him)\b/i.test(name)) return "erkek";
  return null;
}

/** Map one Magento GraphQL product of the UAE shop. Pure. */
export function mapAjmalAE(it: any): ProductRecord | null {
  const mp = it?.price_range?.minimum_price;
  const price = Number(mp?.final_price?.value);
  const regular = Number(mp?.regular_price?.value);
  const name = String(it?.name ?? "").replace(/\s+/g, " ").trim();
  if (!it?.sku || !name || !it?.url_key || !(price > 0)) return null;
  if (mp?.final_price?.currency && mp.final_price.currency !== "AED") return null;
  const sizes: SizeVariant[] = [];
  for (const v of it.variants ?? []) {
    const label = (v?.attributes ?? []).find((a: any) => a?.code === "size")?.label;
    if (!label || sizes.some((s) => s.label === label)) continue;
    sizes.push({ label: String(label), availability: v?.product?.stock_status === "IN_STOCK" ? "in_stock" : "out_of_stock" });
  }
  const gallery: string[] = [...(it.media_gallery ?? [])]
    .filter((m: any) => m && !m.disabled && typeof m.url === "string")
    .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
    .map((m: any) => m.url);
  const first = gallery[0] ?? it.small_image?.url ?? null;
  return {
    brand: "ajmal",
    country: "AE",
    externalId: String(it.sku),
    name,
    url: `${AE_SITE}/${it.url_key}${it.url_suffix ?? ""}`,
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(price),
    listPrice: Number.isFinite(regular) && regular > price ? toMinor(regular) : null,
    currency: "AED",
    inStock: sizes.length ? sizes.some((s) => s.availability === "in_stock") : it.stock_status === "IN_STOCK",
    category: null,
    gender: genderOf(name),
    variants: sizes.length > 1 ? { colors: [], sizes } : null,
  };
}

async function listAE(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, MAX_PAGES); page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, 600));
    const q = new URLSearchParams({ query: AJMAL_QUERY, variables: JSON.stringify({ page }) });
    const data = await getJson<any>(`${AE_SITE}/graphql?${q}`, { country: "AE", headers: { Store: "default" } });
    if (data?.errors?.length && !data?.data) throw new Error(`ajmal/AE: ${data.errors[0]?.message}`);
    const p = data?.data?.products;
    pages = Number(p?.page_info?.total_pages ?? 1);
    for (const it of p?.items ?? []) {
      const r = mapAjmalAE(it);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)];
}

export const brand = "ajmal";

export async function listProducts(country: CountryCode): Promise<ProductRecord[]> {
  if (country === "AE") return listAE();
  // Staff-only listings ("…-employee", flat 20%) are not public deals (2026-10-21).
  if (country === "SA") return (await listShopify(SA_STORE, "SA")).filter((r) => !/-employee(?:[/?#]|$)/i.test(r.url));
  return [];
}
