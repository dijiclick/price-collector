/**
 * PittaRosso (pittarosso.com) — Italy's shoe chain, EUR.
 *
 * The site is a headless Shopify store (Next.js). Its search moved from Algolia
 * to Typesense around 2026-10-21 — the old Algolia app now answers 403 "the
 * application is blocked". The new route, both keys public in the site's own
 * bundle (`NEXT_PUBLIC_TYPESENSE_*`, `NEXT_PUBLIC_SHOPIFY_ACCESS_TOKEN`):
 *
 * - Typesense `tpsns-pit.xphub-run.com`, collection `pittarosso_products_it`
 *   (one document per product, scoped search key). It carries the shop's own
 *   collections, `named_tags.GENDER`/`COLOR`, `stock_level`, title, handle,
 *   image — but NO prices. The deal list is collection `articoli-in-sconto`
 *   with `stock_level > 0`.
 * - Prices and sizes from the Shopify Storefront API (`nodes(ids:)`, 100 a
 *   call): each variant's `price` / `compareAtPrice` / `availableForSale` /
 *   size option, turned into the per-variant records the mapper reads.
 * - NOT a deal: rows in the `omnibus-label-omnibus-not-compliant` collection.
 *   Their PDP shows the strike price but also "Precedentemente era <current
 *   price>" — the lowest price of the last 30 days equals today's, so the
 *   strike price is not a reduction the shop can claim under the Omnibus rule
 *   (547 of 1,367 in-stock deals on 2026-10-21). They are excluded.
 */
import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const TS_HOST = "https://tpsns-pit.xphub-run.com";
const TS_COLLECTION = "pittarosso_products_it";
const TS_KEY = "dHhGRXBCSVdWejRpUlZLMUZYS2VtQXMwaW9tdE9aSDd1ZkN4SVBUV1Mvdz1UQXM5eyJmaWx0ZXJfYnkiOiJoaWRkZW5faTo9MCIsImxpbWl0X211bHRpX3NlYXJjaGVzIjoyNX0=";
const SF_URL = "https://pittarosso.myshopify.com/api/2025-01/graphql.json";
const SF_TOKEN = "3b73d2cdbe54bba09e4cc07d6d213adf";
const SITE = "https://www.pittarosso.com";
const ON_SALE = "articoli-in-sconto";
const NOT_COMPLIANT = "omnibus-label-omnibus-not-compliant";
const TS_PAGE = 250;
const SF_BATCH = 100;
const CAP = 1500;
const MAX_REQUESTS = 40;
const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** named_tags.GENDER → our section. */
export const GENDERS: [string, ProductRecord["gender"]][] = [
  ["DONNA", "kadin"],
  ["UOMO", "erkek"],
  ["UNISEX", null],
  ["BAMBINA", "cocuk"],
  ["BAMBINO", "cocuk"],
  ["RAGAZZA", "cocuk"],
  ["RAGAZZO", "cocuk"],
];

/** Group variant records into one row per product (deals only). Pure. */
export function mapPittaRosso(hits: any[], gender: ProductRecord["gender"], country: CountryCode = "IT"): ProductRecord[] {
  const byProduct = new Map<string, any[]>();
  for (const h of hits) {
    if (h?.id == null) continue;
    const k = String(h.id);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k)!.push(h);
  }
  const out: ProductRecord[] = [];
  for (const [id, vs] of byProduct) {
    const deals = vs.filter((v) => {
      const price = Number(v?.price);
      const cmp = Number(v?.compare_at_price);
      return Number.isFinite(price) && price > 0 && Number.isFinite(cmp) && cmp > price;
    });
    if (!deals.length) continue;
    // Cheapest in-stock reduced size; its own compare price is the strike price.
    const pick = [...deals].sort((a, b) => Number(b.inventory_available === true) - Number(a.inventory_available === true) || a.price - b.price)[0];
    const h = pick;
    if (!h?.title || !h?.handle) continue;
    if ((h.collections ?? []).includes(NOT_COMPLIANT)) continue;
    const sizes: SizeVariant[] = [];
    const seen = new Set<string>();
    for (const v of [...vs].sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0))) {
      const label = String(v?.option1 ?? "").trim();
      if (!label || /default title/i.test(label) || seen.has(label)) continue;
      seen.add(label);
      sizes.push({ label, availability: v.inventory_available === true ? "in_stock" : "out_of_stock" });
    }
    const colour = typeof h?.named_tags?.COLOR === "string" ? h.named_tags.COLOR : null;
    const image = typeof h.image === "string" ? h.image : null;
    out.push({
      brand: "pittarosso",
      country,
      externalId: id,
      name: String(h.title).trim(),
      url: `${SITE}/it/${h.handle}-p`,
      imageUrl: image,
      images: image ? [image] : null,
      price: toMinor(Number(h.price)),
      listPrice: toMinor(Number(h.compare_at_price)),
      currency: "EUR",
      inStock: deals.some((v) => v.inventory_available === true),
      barcodes: (() => {
        const b = [...new Set(vs.map((v) => String(v?.barcode ?? "")).filter((x) => /^\d{8,14}$/.test(x)))];
        return b.length ? b : null;
      })(),
      category: typeof h.product_type === "string" && h.product_type ? h.product_type : null,
      maker: typeof h.vendor === "string" && h.vendor ? h.vendor : null,
      gender,
      variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
      // The query asks for in-stock variants only.
      sizesInStockOnly: true,
      colorName: colour,
    });
  }
  return out;
}

/** Typesense filter for one gender's in-stock markdowns. */
export const baseFilters = (gender: string): string =>
  `collections:=${ON_SALE} && collections:!=${NOT_COMPLIANT} && stock_level:>0 && named_tags.GENDER:=${gender}`;

const SF_QUERY = `query($ids:[ID!]!){nodes(ids:$ids){... on Product{id variants(first:100){nodes{availableForSale barcode selectedOptions{name value} price{amount currencyCode} compareAtPrice{amount}}}}}}`;

/**
 * A Typesense document + its Storefront variants → the per-variant records
 * `mapPittaRosso` reads (in-stock variants only, as the Algolia query was). Pure.
 */
export function toVariantHits(doc: any, product: any): any[] {
  const vs: any[] = product?.variants?.nodes ?? [];
  const colour = Array.isArray(doc?.named_tags?.COLOR) ? doc.named_tags.COLOR[0] : doc?.named_tags?.COLOR;
  return vs
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v?.availableForSale === true && (v?.price?.currencyCode ?? "EUR") === "EUR")
    .map(({ v, i }) => ({
      id: doc.id,
      title: doc.title,
      handle: doc.handle,
      image: doc.image ?? doc.main_image?.src ?? null,
      vendor: doc.vendor,
      product_type: doc.product_type,
      named_tags: { COLOR: colour ?? null },
      collections: doc.collections ?? [],
      inventory_available: true,
      price: Number(v.price?.amount),
      compare_at_price: v.compareAtPrice ? Number(v.compareAtPrice.amount) : 0,
      option1: (v.selectedOptions ?? []).find((o: any) => !/^(title|colou?r|colore)$/i.test(String(o?.name)))?.value ?? null,
      barcode: v.barcode ?? null,
      position: i,
    }));
}

/** Register as `listPittaRosso(country)`. IT only. */
export async function listPittaRosso(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IT") return [];
  let requests = 0;
  const tick = async () => {
    if (++requests > MAX_REQUESTS) throw new Error(`pittarosso/${country}: request budget (${MAX_REQUESTS}) spent`);
    if (requests > 1) await sleep(PAUSE_MS);
  };
  const rows = new Map<string, ProductRecord>();
  for (const [g, gender] of GENDERS) {
    const docs: any[] = [];
    for (let page = 1; ; page++) {
      await tick();
      const q = new URLSearchParams({ q: "*", filter_by: baseFilters(g), per_page: String(TS_PAGE), page: String(page), include_fields: "id,title,handle,image,vendor,product_type,named_tags,collections" });
      const d = await getJson<any>(`${TS_HOST}/collections/${TS_COLLECTION}/documents/search?${q}`, { country, timeoutMs: 30_000, headers: { "X-TYPESENSE-API-KEY": TS_KEY } });
      if (!Array.isArray(d?.hits)) throw new Error(`pittarosso/${country}: bad Typesense answer for ${g}`);
      docs.push(...d.hits.map((h: any) => h?.document).filter((x: any) => x?.id));
      if (d.hits.length < TS_PAGE || page * TS_PAGE >= Number(d.found ?? 0)) break;
    }
    for (let i = 0; i < docs.length; i += SF_BATCH) {
      await tick();
      const batch = docs.slice(i, i + SF_BATCH);
      const d = await getJson<any>(SF_URL, {
        method: "POST",
        country,
        timeoutMs: 30_000,
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": SF_TOKEN },
        body: JSON.stringify({ query: SF_QUERY, variables: { ids: batch.map((x) => `gid://shopify/Product/${x.id}`) } }),
      });
      const nodes: any[] = d?.data?.nodes;
      if (!Array.isArray(nodes)) throw new Error(`pittarosso/${country}: bad Storefront answer (${JSON.stringify(d?.errors ?? d).slice(0, 120)})`);
      const hits = batch.flatMap((doc, k) => toVariantHits(doc, nodes[k]));
      for (const r of mapPittaRosso(hits, gender, country)) if (!rows.has(r.externalId)) rows.set(r.externalId, r);
    }
  }
  if (!rows.size) throw new Error(`pittarosso/${country}: no reduced in-stock products`);
  const all = [...rows.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
