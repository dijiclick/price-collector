/**
 * Druni (druni.es) — Spanish perfumery chain, Magento 2 (Hyvä) storefront.
 *
 * The site's own Magento GraphQL (`/graphql`, GET) is open: 200 from a GitHub
 * runner through Cloudflare (probe run 39612079467, 2026-10-21). The product
 * page prints `regular_price` crossed out ("old-price") next to `final_price`,
 * so a row is a deal only when regular > final.
 *
 * Read per top shelf (Perfumes, Maquillaje, Cosmética, Cabello), 250 products a
 * page, one page per shelf per round, round-robin, until the cap. A
 * configurable product (a perfume in 30/50/100 ml, a shade range) is one
 * record per variant — each has its own SKU, price and stock — grouped by the
 * parent SKU. Brands are the `manufacturer` option ids, resolved through one
 * `customAttributeMetadataV2` call per run.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const ORIGIN = "https://www.druni.es";
const API = `${ORIGIN}/graphql`;
/** Top shelves in priority order: Perfumes, Maquillaje, Cosmética, Cabello. */
export const DRUNI_SHELVES = ["4", "3", "10", "11"];
const PAGE_SIZE = 250;
const MAX_REQUESTS = 40;
const CAP = 1500;
const PAUSE_MS = Number(process.env.DRUNI_PAUSE_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRICE = "price_range { minimum_price { regular_price { value } final_price { value } } }";
export const productsQuery = (category: string, page: number): string =>
  `{ products(filter: { category_id: { eq: "${category}" } }, pageSize: ${PAGE_SIZE}, currentPage: ${page}) {
  total_count page_info { total_pages }
  items { __typename sku name url_key url_suffix stock_status manufacturer small_image { url }
    categories { id name url_path level } ${PRICE}
    ... on ConfigurableProduct { variants { attributes { code label } product { sku stock_status small_image { url } ${PRICE} } } } } } }`;
/**
 * Portugal (2026-10-21): www.druni.pt is a separate Magento store ("Default
 * Category Druni Portugal") with its own category ids — the Spanish ids mean
 * other shelves there (7 = Marcas, 25 = Maquilhagem) — so shelves and the
 * audience ids are per market. Its GraphQL is open the same way.
 */
interface DruniMarket {
  origin: string;
  shelves: string[];
  men: Set<number>;
  women: Set<number>;
  kids: Set<number>;
  notAType: RegExp;
  acceptLanguage: string;
}
const DRUNI_PT: DruniMarket = {
  origin: "https://www.druni.pt",
  // Perfumes, Maquilhagem, Cosméticos, Produtos para Cabelo.
  shelves: ["19", "25", "21", "16"],
  men: new Set([8, 86, 115, 765, 862, 51, 339, 717, 199]),
  women: new Set([98, 731, 808, 42, 313, 689, 181]),
  kids: new Set([166, 175, 127, 343]),
  notAType: /^(luxo|cosm[eé]ticos de lujo|cosm[eé]ticos low cost|maquilhagem (de luxo|barata)|perfumes baratos|novidades|novos|promo[cç][oõ]es|presentes|outlet|mais vendidos|marcas|perfumes nicho|perfumes xl)/i,
  acceptLanguage: "pt-PT,pt;q=0.9",
};
const marketOf = (country: CountryCode): DruniMarket | null => (country === "PT" ? DRUNI_PT : null);

const BRANDS_QUERY =
  '{ customAttributeMetadataV2(attributes: [{ attribute_code: "manufacturer", entity_type: "catalog_product" }]) { items { options { label value } } } }';

const gql = (q: string, api = API): string => `${api}?query=${encodeURIComponent(q.replace(/\s+/g, " ").trim())}`;
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
/** The feed's image URL asks for an empty width (a small default); ask for 800 px. Pure. */
export const druniImage = (u: unknown): string | null =>
  typeof u === "string" && /^https:\/\//.test(u) ? `${u.split("?")[0]}?quality=80&fit=bounds&width=800` : null;

/** Category ids that say who a product is for. */
const MEN = new Set([6, 3917]);
const WOMEN = new Set([7]);
const KIDS = new Set([25, 3270]);
/** Shelves that describe a price tier or a promotion, not what the product is. */
const NOT_A_TYPE = /^(lujo|low cost|novedades|ofertas|premium|marcas|regalos|perfumes premium|fragancias low ?cost)/i;

export function druniGender(categories: any[], country: CountryCode = "ES"): ProductRecord["gender"] {
  const mk = marketOf(country);
  const [MEN_, WOMEN_, KIDS_] = mk ? [mk.men, mk.women, mk.kids] : [MEN, WOMEN, KIDS];
  const ids = (categories ?? []).map((c) => Number(c?.id));
  if (ids.some((i) => KIDS_.has(i))) return "cocuk";
  const m = ids.some((i) => MEN_.has(i));
  const w = ids.some((i) => WOMEN_.has(i));
  if (m && !w) return "erkek";
  if (w && !m) return "kadin";
  return null;
}

/** The deepest category that names a product type ("Perfumes Mujer", "Ojos"). Pure. */
export function druniCategory(categories: any[], country: CountryCode = "ES"): string | null {
  const notAType = marketOf(country)?.notAType ?? NOT_A_TYPE;
  const list = (categories ?? [])
    .filter((c) => c?.name && !String(c.url_path ?? "").startsWith("marcas") && !String(c.url_path ?? "").startsWith("regalos"))
    .filter((c) => !notAType.test(clean(c.name)))
    .sort((a, b) => Number(b.level ?? 0) - Number(a.level ?? 0));
  return list.length ? clean(list[0].name) : null;
}

const prices = (pr: any): [number, number] => [
  Number(pr?.minimum_price?.final_price?.value),
  Number(pr?.minimum_price?.regular_price?.value),
];

/** One GraphQL product → one record per struck-price variant (or itself, if simple). Pure. */
export function mapDruni(p: any, brands: Map<string, string> = new Map(), country: CountryCode = "ES"): ProductRecord[] {
  const name = clean(p?.name);
  if (!p?.sku || !name || !p?.url_key) return [];
  const url = `${marketOf(country)?.origin ?? ORIGIN}/${p.url_key}${p.url_suffix ?? ""}`;
  const maker = brands.get(String(p.manufacturer ?? "")) ?? null;
  const base = {
    brand: "druni",
    country,
    name: maker && !name.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${name}` : name,
    url,
    currency: "EUR",
    category: druniCategory(p.categories, country),
    maker,
    gender: druniGender(p.categories, country),
  };
  const rows: { sku: string; label: string; stock: string; image: string | null; pr: any }[] =
    p.__typename === "ConfigurableProduct" && Array.isArray(p.variants) && p.variants.length
      ? p.variants.map((v: any) => ({
          sku: String(v?.product?.sku ?? ""),
          label: clean((v?.attributes ?? []).map((a: any) => a?.label).filter(Boolean).join(" / ")),
          stock: v?.product?.stock_status,
          image: v?.product?.small_image?.url ?? p.small_image?.url ?? null,
          pr: v?.product?.price_range,
        }))
      : [{ sku: String(p.sku), label: "", stock: p.stock_status, image: p.small_image?.url ?? null, pr: p.price_range }];
  const out: ProductRecord[] = [];
  for (const v of rows) {
    const [price, was] = prices(v.pr);
    if (!v.sku || !Number.isFinite(price) || price <= 0 || !Number.isFinite(was) || was <= price) continue;
    const inStock = v.stock === "IN_STOCK";
    const isAmount = /^\d[\d.,]*\s*(ml|l|cl|g|gr|kg|mg|ud|uds|u)\b/i.test(v.label);
    const images = cleanGallery([druniImage(v.image)]);
    out.push({
      ...base,
      externalId: v.sku,
      imageUrl: images?.[0] ?? null,
      images,
      price: toMinor(price),
      listPrice: toMinor(was),
      inStock,
      variants: v.label
        ? {
            colors: isAmount ? [] : [v.label],
            sizes: isAmount ? [{ label: v.label, availability: inStock ? "in_stock" : "out_of_stock" }] : [],
          }
        : null,
      groupKey: rows.length > 1 || v.label ? `druni-${p.sku}` : null,
      colorName: v.label || null,
    });
  }
  return out;
}

async function brandNames(country: CountryCode): Promise<Map<string, string>> {
  try {
    const mk = marketOf(country);
    const d = await getJson<any>(gql(BRANDS_QUERY, mk ? `${mk.origin}/graphql` : API), {
      country,
      headers: { "Accept-Language": mk?.acceptLanguage ?? "es-ES,es;q=0.9" },
    });
    const opts: any[] = d?.data?.customAttributeMetadataV2?.items?.[0]?.options ?? [];
    return new Map(opts.map((o) => [String(o.value), clean(o.label)]));
  } catch {
    return new Map(); // names still carry the product line; the maker is a nice-to-have
  }
}

/** Register as `listDruni(country)`. ES and PT. */
export async function listDruni(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "ES" && country !== "PT") return [];
  const mk = marketOf(country);
  const api = mk ? `${mk.origin}/graphql` : API;
  const headers = { "Accept-Language": mk?.acceptLanguage ?? "es-ES,es;q=0.9" };
  const brands = await brandNames(country);
  const byId = new Map<string, ProductRecord>();
  const next = new Map<string, number>((mk?.shelves ?? DRUNI_SHELVES).map((c) => [c, 1]));
  let requests = 1;
  let inStock = 0;
  while (next.size && requests < MAX_REQUESTS && inStock < CAP) {
    for (const [cat, page] of [...next]) {
      if (requests >= MAX_REQUESTS || inStock >= CAP) break;
      await sleep(PAUSE_MS);
      requests++;
      const d = await getJson<any>(gql(productsQuery(cat, page), api), { country, headers });
      const res = d?.data?.products;
      const items: any[] = res?.items ?? [];
      for (const p of items) {
        for (const r of mapDruni(p, brands, country)) {
          if (byId.has(r.externalId)) continue;
          byId.set(r.externalId, r);
          if (r.inStock) inStock++;
        }
      }
      if (!items.length || page >= Number(res?.page_info?.total_pages ?? 0)) next.delete(cat);
      else next.set(cat, page + 1);
    }
  }
  const all = [...byId.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
