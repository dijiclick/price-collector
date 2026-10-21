import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";
import type { CountryCode } from "../../../../lib/countries";
import { listRossmannDe } from "./rossmann-de";

/**
 * Rossmann (rossmann.com.tr) is collected from its SEARCH PROVIDER, wawlabs —
 * not from the store's Magento GraphQL.
 *
 * Why (2026-10-12): `/graphql` sits behind a Cloudflare rule that refuses
 * GitHub's runners outright — 9 of 9 POST/GET requests from a probe runner got
 * Cloudflare's 4.5 KB block page in 12–300 ms, while the site's HTML pages
 * answer the same runner 200. So the collector's direct attempt never once
 * succeeded there: every page went out through the residential proxy, which
 * Turkey must never use (owner rule), and the brand-wide 403s (2 runs in 17)
 * were the proxy's Turkish exits being refused too. No header or rate change
 * can fix a block that is per-network.
 *
 * `rossmann.wawlabs.com/search_v2` is the site's own search box backend. It is
 * a different host on a different Cloudflare zone, answers GitHub runners 200
 * (probe 2026-10-12), and carries everything the GraphQL route gave us except
 * the photo gallery. Checked against a full GraphQL sweep the same hour, over
 * the 8,262 SKUs both returned:
 *   - shelf price `price` = Magento final price, and `sale_price` = the direct
 *     markdown (`ross_60_price`), NOT the Rossmann Card price — 8,231 equal;
 *     the other 31 are sold-out items whose markdown GraphQL had dropped;
 *   - `availability` matched `stock_status` on 8,261;
 *   - `link` is the same product URL, `gtin` the EAN, `id` the same SKU.
 * It also found 806 SKUs the GraphQL pager had missed (Magento paging with no
 * sort is not stable), and lacks 63 (mostly BND… bundle SKUs).
 *
 * The one thing it caps: a query returns at most 1,000 hits (`*` included). So
 * the catalogue is reached by querying every category name the facets reveal,
 * breadth-first from `*` — ~250 queries, ~9,000 SKUs, ~20 s from here, gzip
 * makes the ~50 MB of JSON ~12 MB on the wire.
 *
 * No `images`: the index has one photo per SKU. Leaving `images` unset keeps
 * every gallery already stored (db.ts only touches product_images for records
 * that carry one), and no `category` either: `classifyType` reads it, and
 * product types were set from the name alone until now.
 */
const SITE = "https://www.rossmann.com.tr";
const SEARCH = "https://rossmann.wawlabs.com/search_v2";
/** The index's own ceiling per query. */
const ROWS = 1000;
/** Queries in flight at once. A third party's search box — no need to push it. */
const CONCURRENCY = 4;
/** ~250 today. A runaway guard, not a target. */
const MAX_QUERIES = Number(process.env.ROSSMANN_MAX_QUERIES ?? 500);

export const searchUrl = (query: string): string =>
  `${SEARCH}?${new URLSearchParams({
    search_params: JSON.stringify({ query, row_per_page: ROWS, page_number: 1 }),
  })}`;

/** "1,150.00" → 1150. The index formats money en-US style, as a string. */
export function money(v: unknown): number {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

export function mapHit(h: any): ProductRecord | null {
  const sku = String(h?.id ?? "").trim();
  const link = String(h?.link ?? "");
  const base = money(h?.price);
  const sale = money(h?.sale_price);
  if (!sku || !link.startsWith(`${SITE}/`) || !(base > 0)) return null;
  // `sale_price` is the shelf markdown everyone pays (ross_60_price); a Card-
  // only price never appears in it. Equal or zero means no markdown.
  const price = sale > 0 && sale < base ? sale : base;
  const bc = String(h.gtin ?? "").replace(/\D/g, "");
  return {
    brand: "rossmann",
    externalId: sku,
    barcodes: bc.length >= 8 && bc.length <= 14 ? [bc] : null,
    name: String(h.title ?? "").trim(),
    url: link,
    imageUrl: typeof h.image_link === "string" && h.image_link ? h.image_link : null,
    price: toMinor(price),
    listPrice: price < base ? toMinor(base) : null,
    currency: "TRY",
    inStock: h.availability === "in stock",
    category: null,
  };
}

/**
 * Breadth-first over category names: query `*`, then every category the
 * results' facets name, then any new ones those reveal. Hits are unioned by
 * SKU.
 *
 * FULL CATALOGUE, so every gap THROWS (2026-10-19): the run's sweep marks every
 * SKU it did not see as sold out, so a failed query (after getJson's retries),
 * a category that comes back at the index's 1,000-row ceiling (its slice would
 * be cut — only the `*` seed is allowed to be), or names still queued at the
 * query cap all fail the run instead of shipping a partial catalogue. Measured
 * 10-19: 253 queries, 8,839 SKUs, only `*` at the ceiling, ~22 s.
 */
export async function crawl(
  search: (query: string) => Promise<any>,
  maxQueries = MAX_QUERIES,
  width = CONCURRENCY,
): Promise<{ hits: Map<string, any>; queries: number }> {
  const hits = new Map<string, any>();
  const asked = new Set<string>();
  const queue: string[] = [];
  const absorb = (j: any) => {
    for (const h of j?.res ?? []) if (h?.id != null && !hits.has(String(h.id))) hits.set(String(h.id), h);
    for (const f of j?.facet_fields?.category ?? []) {
      const name = String(f?.name ?? "").trim();
      const key = name.toLocaleLowerCase("tr");
      if (name && !asked.has(key)) {
        asked.add(key);
        queue.push(name);
      }
    }
  };
  absorb(await search("*"));
  let queries = 1;
  while (queue.length) {
    if (queries >= maxQueries) throw new Error(`rossmann: ${queue.length} categories still queued at the ${maxQueries}-query cap`);
    const wave = queue.splice(0, Math.min(width, maxQueries - queries));
    queries += wave.length;
    const replies = await Promise.all(
      wave.map((q) =>
        search(q).catch((e) => {
          throw new Error(`rossmann: query "${q}" failed (${e?.message ?? e})`);
        }),
      ),
    );
    // In wave order, so the queue (and the result) does not depend on timing.
    replies.forEach((j, i) => {
      if ((j?.res ?? []).length >= ROWS) throw new Error(`rossmann: "${wave[i]}" hit the ${ROWS}-row ceiling; its slice would be cut`);
      absorb(j);
    });
  }
  return { hits, queries };
}

export const brand = "rossmann";

/**
 * Turkey is the wawlabs crawl below, unchanged. Germany (2026-10-21) is a
 * different company's shop with its own app API — see rossmann-de.ts.
 */
export async function listProducts(country: CountryCode = "TR"): Promise<ProductRecord[]> {
  if (country === "DE") return listRossmannDe();
  if (country !== "TR") return [];
  const t0 = Date.now();
  // Direct only (no `proxy`): Turkey never goes through the proxy. getJson
  // retries a failed query twice with backoff.
  const { hits, queries } = await crawl((q) => getJson(searchUrl(q), { retries: 2 }));
  const out: ProductRecord[] = [];
  for (const h of hits.values()) {
    const rec = mapHit(h);
    if (rec) out.push(rec);
  }
  console.log(`rossmann: ${queries} search queries, ${out.length} products in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return out;
}
