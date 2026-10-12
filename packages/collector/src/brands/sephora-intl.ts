/**
 * Sephora US + Canada — the Constructor.io browse index Sephora's own Android
 * app reads (`sephora.cnstrc.com`, app version 5.x, `ConstructorApiKeyProvider`).
 * Turkey is a different platform (SFCC OCAPI, sephora.ts) and is untouched.
 *
 * Why not sephora.com any more: since 2026-10-12 `www.sephora.com/api/v2/
 * catalog/categories/…/products` answers every request with ONE stale grid
 * (the US "Skincare Sale" page, 102,127 bytes, even for `pageSize=3`, for a CA
 * request, for a cache-busting param) — its istio upstream is unhealthy ("no
 * healthy upstream" when it fails outright) and something in front of it
 * replays the last good body. Cache-busting can't fix a dead origin, so the
 * adapter left that host.
 *
 * Constructor holds one index PER MARKET, chosen by the key (the app ships a
 * public search key for en-US, en-CA and fr-CA), so a CA request can't be
 * answered from the US index by a shared cache. `/browse/on_sale/true` is the
 * site's whole sale tree in one paginated list (200 per page; measured
 * 2026-10-12: US 215, CA 596). Each response is still checked, because a
 * wrong-market answer is the bug this file was rewritten for:
 *   - the echoed `request` must be this browse and this page;
 *   - every product carries its market's stock network in `sku_availability`
 *     (`network_SEPHORAUS` / `network_SEPHORACA`; each index only knows its
 *     own). A page holding the other market's network is rejected whole, and a
 *     product with no network at all is dropped (nothing proves its market).
 *
 * Prices are per SKU (`listPriceFloat` / `salePriceFloat`), and `variations`
 * lists the product's SKUs that match the sale filter. When those disagree
 * (a fragrance's 100 ml and 50 ml at different prices) the card would be a
 * price RANGE on the site — the TR −%81 artifact — so the product is dropped
 * rather than quoted from one size. Beauty Insider–exclusive and BI-reward
 * SKUs are member prices and are skipped.
 *
 * Stock: the network value is 0 for a SKU that can't be bought online and 1/2
 * when it can (checked 2026-10-12: Constructor's own `availability` filter
 * keeps exactly the products with a non-zero sale SKU). Most clearance SKUs are
 * 0, so sold-out rows are kept with `inStock: false` (restock alerts), sorted
 * after the buyable ones.
 */
import { cleanGallery, type ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import { COUNTRIES, type CountryCode } from "../../../../lib/countries";

export const SEPHORA_INTL_MARKETS: Partial<Record<CountryCode, { key: string; network: string; site: string }>> = {
  US: { key: "u7PNVQx-prod-en-us", network: "network_SEPHORAUS", site: "https://www.sephora.com" },
  CA: { key: "q9813cA-prod-en-ca", network: "network_SEPHORACA", site: "https://www.sephora.com/ca/en" },
};
const NETWORKS = Object.values(SEPHORA_INTL_MARKETS).map((m) => m!.network);

const HOST = "https://sephora.cnstrc.com";
/** The Constructor Android SDK the app embeds identifies itself this way. */
const CLIENT = "cioand-2.34.1";
const PAGE = 200;
const MAX_PAGES = 8;
const PAUSE_MS = Number(process.env.SEPHORA_INTL_PAUSE_MS ?? 400);
const CAP = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One run's anonymous client id, as the SDK would generate on install. */
const CLIENT_ID = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-modadrop`) as string;

export function browseUrl(country: CountryCode, page: number): string {
  const m = SEPHORA_INTL_MARKETS[country]!;
  const q = new URLSearchParams({
    key: m.key,
    c: CLIENT,
    i: CLIENT_ID,
    s: "1",
    page: String(page),
    num_results_per_page: String(PAGE),
  });
  // Hidden by default; asking for just the two network entries (not the
  // ~600 per-store ones) is what proves the market of every product.
  for (const n of NETWORKS) q.append("fmt_options[hidden_fields]", `sku_availability.${n}`);
  return `${HOST}/browse/on_sale/true?${q}`;
}

/** Which market's stock network a result/variation carries: a country, "other" (several/unknown), or null (none). */
export function networkOf(data: any): CountryCode | "other" | null {
  const keys = Object.keys(data?.sku_availability ?? {}).filter((k) => k.startsWith("network_"));
  if (keys.length === 0) return null;
  const hits = (Object.keys(SEPHORA_INTL_MARKETS) as CountryCode[]).filter((c) => keys.includes(SEPHORA_INTL_MARKETS[c]!.network));
  return hits.length === 1 && keys.length === 1 ? hits[0] : "other";
}

/**
 * Why a browse response can't be used for (country, page), or null when it can.
 * See the header: the request echo must match and no product may belong to
 * another market.
 */
export function rejectReason(data: any, country: CountryCode, page: number): string | null {
  const req = data?.request;
  const results = data?.response?.results;
  if (!Array.isArray(results)) return "no results array";
  if (req?.browse_filter_name !== "on_sale" || String(req?.browse_filter_value) !== "true") return "answers another browse";
  if (Number(req?.page) !== page) return `answers page ${req?.page}`;
  const markets = results.map((r: any) => networkOf(r?.data));
  if (markets.some((m) => m != null && m !== country)) return "carries another market's stock network";
  if (results.length > 0 && !markets.includes(country)) return "nothing in it proves the market";
  return null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface SaleSku {
  list: number;
  sale: number;
  inStock: boolean;
  url: string | null;
  sku: any;
}

/** A SKU as a markdown, or null when it isn't one (no discount, member-only, unknown market). */
function saleSku(d: any, country: CountryCode): SaleSku | null {
  const sku = d?.currentSku;
  if (!sku) return null;
  if (networkOf(d) !== country) return null;
  // Beauty Insider tiers and reward items are member prices, not markdowns.
  if (sku.isBI === true || sku.isBI === "true") return null;
  if (sku.biExclusivityLevel && sku.biExclusivityLevel !== "none") return null;
  const list = num(sku.listPriceFloat);
  const sale = num(sku.salePriceFloat);
  if (list == null || sale == null || !(sale < list)) return null;
  // "final" differs from "sale" only for conditional offers; quote neither.
  const fin = num(sku.finalPriceFloat);
  if (fin != null && fin !== sale) return null;
  const avail = Number(d.sku_availability[SEPHORA_INTL_MARKETS[country]!.network] ?? 0);
  return { list, sale, inStock: avail > 0, url: typeof d.url === "string" ? d.url : null, sku };
}

/** One browse result → a record, or null when it is not a single-price markdown. */
export function mapSephoraResult(r: any, country: CountryCode): ProductRecord | null {
  const m = SEPHORA_INTL_MARKETS[country];
  const d = r?.data;
  if (!m || !d?.id) return null;
  const variations: any[] = Array.isArray(r.variations) && r.variations.length ? r.variations.map((v: any) => v?.data) : [d];
  const skus = variations.map((v) => saleSku(v, country)).filter((s): s is SaleSku => s != null);
  if (skus.length === 0) return null;
  // Several prices across the sale SKUs = a range card on the site: no single was-price to quote.
  if (new Set(skus.map((s) => `${s.list}/${s.sale}`)).size > 1) return null;
  const head = saleSku(d, country);
  const pick =
    (head?.inStock && skus.find((s) => s.sku?.skuId === head.sku?.skuId)) || skus.find((s) => s.inStock) || head || skus[0];
  const big = (u: unknown) => (typeof u === "string" ? u.replace(/imwidth=\d+/, "imwidth=1000") : null);
  const img = big(pick.sku.skuImages?.heroImage ?? d.image_url);
  const alt = big(pick.sku.skuImages?.altImage);
  const path = pick.url ?? d.url ?? `/product/${d.id}`;
  const title = typeof r.value === "string" ? r.value : null;
  return {
    brand: "sephora",
    country,
    externalId: String(d.id),
    name: [d.brandName, title].filter(Boolean).join(" ").trim(),
    url: `${m.site}${path.startsWith("/") ? "" : "/"}${path}`,
    imageUrl: img,
    images: cleanGallery([img, alt], img),
    price: toMinor(pick.sale),
    listPrice: toMinor(pick.list),
    currency: COUNTRIES[country].currency,
    inStock: skus.some((s) => s.inStock),
    // Same convention as the TR adapter: the brand rides in `category`.
    category: typeof d.brandName === "string" ? d.brandName : null,
    gender: null,
    variants: null,
    colorName: null,
  };
}

export async function listSephoraIntl(country: CountryCode): Promise<ProductRecord[]> {
  if (!SEPHORA_INTL_MARKETS[country]) return [];
  const byId = new Map<string, ProductRecord>();
  const refused: string[] = [];
  let pagesOk = 0;
  let total = 0;
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES && byId.size < CAP; page++) {
    if (page > 1) await sleep(PAUSE_MS);
    const data = await getJson<any>(browseUrl(country, page), { country }).catch((e) => {
      refused.push(`page ${page}: ${String(e?.message ?? e).slice(0, 80)}`);
      return null;
    });
    if (!data) break;
    const why = rejectReason(data, country, page);
    if (why) {
      refused.push(`page ${page}: ${why}`);
      break;
    }
    pagesOk++;
    const results: any[] = data.response.results;
    for (const r of results) {
      if (r?.data?.id) seen.add(String(r.data.id));
      const rec = mapSephoraResult(r, country);
      if (rec && !byId.has(rec.externalId)) byId.set(rec.externalId, rec);
    }
    total = Number(data.response.total_num_results ?? 0);
    if (results.length < PAGE || page * PAGE >= total) break;
  }
  // Pages are ranked per client id; a ranking that moved mid-sweep would skip products.
  if (!refused.length && seen.size < Math.min(total, CAP)) console.warn(`sephora/${country}: saw ${seen.size} of ${total} sale products`);
  if (refused.length) console.warn(`sephora/${country}: ${refused.join("; ")}`);
  if (pagesOk === 0) throw new Error(`sephora/${country}: Constructor browse refused (${refused.join("; ")})`);
  const rows = [...byId.values()];
  // Buyable first, so the cap never trims an in-stock markdown for a sold-out one.
  rows.sort((a, b) => Number(b.inStock) - Number(a.inStock));
  return rows.slice(0, CAP);
}

export const brand = "sephora";
export const listProducts = listSephoraIntl;
