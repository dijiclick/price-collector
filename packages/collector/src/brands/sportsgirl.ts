/**
 * Sportsgirl (sportsgirl.com.au) — Australian women's fashion on Magento 2.
 * The storefront's own GraphQL endpoint answers plain GETs with no key or
 * cookie (measured 2026-10-11): `categoryList(url_key: "sale")` gives the sale
 * category (~570 products), and `products(category_uid)` pages it 100 at a
 * time with regular + final price in AUD.
 *
 * Sizes: a configurable product's `configurable_options` lists every size it
 * comes in, while `variants` lists only the orderable ones (Magento hides
 * out-of-stock children from the storefront). So a size in the options but not
 * among the variants is sold out — exactly the signal restock alerts need.
 *
 * The endpoint is slow (~11-17 s per 100-product page), which is why pages are
 * 100 and the field list is kept to what the mapping reads.
 */
import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

const SITE = "https://www.sportsgirl.com.au";
const PAGE = 100;
const MAX_PAGES = Number(process.env.SPORTSGIRL_MAX_PAGES ?? 15);
const PAUSE_MS = Number(process.env.SPORTSGIRL_PAUSE_MS ?? 500);
const CAP = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATEGORY_QUERY = `{ categoryList(filters: { url_key: { eq: "sale" } }) { uid url_path product_count } }`;

export const PRODUCTS_QUERY = `query Sale($uid: String!, $p: Int!) {
  products(filter: { category_uid: { eq: $uid } }, pageSize: ${PAGE}, currentPage: $p) {
    total_count
    page_info { total_pages }
    items {
      __typename sku name url_key url_suffix stock_status
      categories { name url_path }
      small_image { url }
      media_gallery { url disabled position }
      price_range { minimum_price { regular_price { value currency } final_price { value currency } } }
      ... on ConfigurableProduct {
        configurable_options { attribute_code values { label } }
        variants { attributes { code label } }
      }
    }
  }
}`;

const gql = (query: string, variables?: Record<string, unknown>) =>
  `${SITE}/graphql?query=${encodeURIComponent(query)}${
    variables ? `&variables=${encodeURIComponent(JSON.stringify(variables))}` : ""
  }`;

/** The product type: the deepest category outside the sale/new-in trees. */
function categoryOf(cats: any[]): string | null {
  const real = (cats ?? []).filter(
    (c) => typeof c?.url_path === "string" && !/^(sale|new-to-sale|new-in|whats-new|gifts?)(\/|$)/.test(c.url_path),
  );
  real.sort((a, b) => b.url_path.split("/").length - a.url_path.split("/").length);
  const name = real[0]?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Map one GraphQL product item. Pure. */
export function mapSportsgirl(it: any, country: CountryCode = "AU"): ProductRecord | null {
  const mp = it?.price_range?.minimum_price;
  const price = Number(mp?.final_price?.value);
  const regular = Number(mp?.regular_price?.value);
  const currency = COUNTRIES[country].currency;
  if (!it?.sku || !it?.name || !it?.url_key) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (mp?.final_price?.currency && mp.final_price.currency !== currency) return null;

  const opts: any[] = it.configurable_options ?? [];
  const sizeOpt = opts.find((o) => o?.attribute_code === "size");
  const colourOpt = opts.find((o) => /colou?r/.test(String(o?.attribute_code ?? "")));
  const stocked = new Set<string>();
  for (const v of it.variants ?? []) {
    for (const a of v?.attributes ?? []) if (a?.code === "size" && a?.label) stocked.add(String(a.label).trim());
  }
  const sizes: SizeVariant[] = [];
  for (const val of sizeOpt?.values ?? []) {
    const label = String(val?.label ?? "").trim();
    if (!label || sizes.some((s) => s.label === label)) continue;
    sizes.push({ label, availability: stocked.has(label) ? "in_stock" : "out_of_stock" });
  }
  const colors: string[] = (colourOpt?.values ?? []).map((v: any) => String(v?.label ?? "").trim()).filter(Boolean);
  const gallery: string[] = [...(it.media_gallery ?? [])]
    .filter((m) => m && !m.disabled && typeof m.url === "string")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((m) => m.url);
  const first = typeof it.small_image?.url === "string" ? it.small_image.url : gallery[0] ?? null;
  const inStock = sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : it.stock_status === "IN_STOCK";

  return {
    brand: "sportsgirl",
    country,
    externalId: String(it.sku),
    name: String(it.name).trim(),
    url: `${SITE}/${it.url_key}${it.url_suffix ?? ""}`,
    imageUrl: first,
    images: cleanGallery(gallery, first),
    price: toMinor(price),
    listPrice: Number.isFinite(regular) && regular > price ? toMinor(regular) : null,
    currency,
    inStock,
    category: categoryOf(it.categories),
    gender: "kadin",
    variants: sizes.length ? { colors, sizes } : null,
    colorName: colors.length === 1 ? colors[0] : null,
  };
}

export async function listSportsgirl(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "AU") return [];
  const cat = await getJson<any>(gql(CATEGORY_QUERY), { country });
  const uid: string | undefined = (cat?.data?.categoryList ?? []).find((c: any) => c?.url_path === "sale")?.uid;
  if (!uid) throw new Error("sportsgirl/AU: sale category not found");

  const byId = new Map<string, ProductRecord>();
  let pages = 1;
  for (let p = 1; p <= Math.min(pages, MAX_PAGES); p++) {
    await sleep(PAUSE_MS);
    const d = await getJson<any>(gql(PRODUCTS_QUERY, { uid, p }), { country, retries: 1 });
    const conn = d?.data?.products;
    if (!conn) {
      if (p === 1) throw new Error(`sportsgirl/AU: ${String(d?.errors?.[0]?.message ?? "no products")}`);
      break;
    }
    pages = Number(conn.page_info?.total_pages ?? 1);
    for (const it of conn.items ?? []) {
      const r = mapSportsgirl(it, country);
      if (r && r.listPrice != null) byId.set(r.externalId, r);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
