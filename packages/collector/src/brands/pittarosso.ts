/**
 * PittaRosso (pittarosso.com) — Italy's shoe chain, EUR.
 *
 * The site is a headless Shopify store (Next.js) whose search runs on Algolia:
 * app `CMQTX6QV1X`, public search key and index from the site's own bundle
 * (`NEXT_PUBLIC_ALGOLIA_*`). Algolia answers a GitHub runner directly (probe run
 * 39635106148), no proxy.
 *
 * - One Algolia record per VARIANT (size), with `price`, `compare_at_price`,
 *   `price_ratio` (price / compare, 0 when there is no compare price),
 *   `inventory_available`, `option1` (= size), `named_tags.GENDER`,
 *   `product_type` and the product's `collections`.
 * - Deals filter: `price_ratio` in (0, 0.99) and in stock. All records of a
 *   product are grouped back into one row with per-size stock.
 * - NOT a deal: rows in the `omnibus-label-omnibus-not-compliant` collection.
 *   Their PDP shows the strike price but also "Precedentemente era <current
 *   price>" — the lowest price of the last 30 days equals today's, so the
 *   strike price is not a reduction the shop can claim under the Omnibus rule
 *   (547 of 1,367 in-stock deals on 2026-10-21). They are excluded.
 * - Algolia stops at 1,000 hits per query, so the walk is split by gender and,
 *   when a slice is still larger, by price band — every slice must come back
 *   whole or the run throws.
 */
import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";

const APP = "CMQTX6QV1X";
const KEY = "506d21d2a74394abc76c10684c5c90ea";
const INDEX = "shopify_prod_products_custom_ranking";
const SITE = "https://www.pittarosso.com";
const URL_Q = `https://${APP}-dsn.algolia.net/1/indexes/${INDEX}/query`;
const NOT_COMPLIANT = "omnibus-label-omnibus-not-compliant";
/** Only what the mapper reads — full records carry body_html and ~40 collections (9.5 MB per 1,000). */
const ATTRS = "id,title,handle,image,vendor,product_type,named_tags.COLOR,collections,inventory_available,price,compare_at_price,option1,barcode,position";
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

export const baseFilters = (gender: string): string =>
  `inventory_available:true AND named_tags.GENDER:"${gender}" AND NOT collections:${NOT_COMPLIANT}`;

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

async function query(params: string): Promise<any> {
  return getJson<any>(URL_Q, {
    method: "POST",
    country: "IT",
    timeoutMs: 30_000,
    headers: { "X-Algolia-Application-Id": APP, "X-Algolia-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });
}

/** Register as `listPittaRosso(country)`. IT only. */
export async function listPittaRosso(country: CountryCode): Promise<ProductRecord[]> {
  if (country !== "IT") return [];
  let requests = 0;
  const rows = new Map<string, ProductRecord>();
  // One slice = gender × price band; split the band until Algolia can return it whole.
  const slice = async (g: string, lo: number, hi: number): Promise<any[]> => {
    if (++requests > MAX_REQUESTS) throw new Error(`pittarosso/${country}: request budget (${MAX_REQUESTS}) spent`);
    if (requests > 1) await sleep(PAUSE_MS);
    const numeric = `price_ratio>0,price_ratio<0.99,price>=${lo},price<${hi}`;
    const d = await query(
      `hitsPerPage=1000&filters=${encodeURIComponent(baseFilters(g))}&numericFilters=${encodeURIComponent(numeric)}` +
        `&attributesToRetrieve=${encodeURIComponent(ATTRS)}&attributesToHighlight=${encodeURIComponent("[]")}`,
    );
    const nb = Number(d?.nbHits);
    if (!Array.isArray(d?.hits) || !Number.isFinite(nb)) throw new Error(`pittarosso/${country}: bad Algolia answer for ${g}`);
    if (nb <= 1000) return d.hits;
    if (hi - lo < 1) throw new Error(`pittarosso/${country}: ${g} slice ${lo}-${hi} has ${nb} variants (> 1000)`);
    const mid = Math.round(((lo + hi) / 2) * 100) / 100;
    return [...(await slice(g, lo, mid)), ...(await slice(g, mid, hi))];
  };
  for (const [g, gender] of GENDERS) {
    const hits = await slice(g, 0, 1000);
    for (const r of mapPittaRosso(hits, gender, country)) if (!rows.has(r.externalId)) rows.set(r.externalId, r);
  }
  const all = [...rows.values()];
  return [...all.filter((r) => r.inStock), ...all.filter((r) => !r.inStock)].slice(0, CAP);
}
