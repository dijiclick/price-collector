import type { ProductRecord } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

// Magento 2 storefront: public GraphQL endpoint, no auth or proxy needed.
const GRAPHQL = "https://www.rossmann.com.tr/graphql";
const SITE = "https://www.rossmann.com.tr";
const PAGE_SIZE = 100;

/**
 * Page the catalogue directly instead of walking the category tree.
 *
 * The tree has 1,007 leaves and we were visiting 10 of them — 1,213 products,
 * which is why searches for brands Rossmann genuinely stocks (Beauty of Joseon
 * among them) came back empty and Rossmann sat last in the catalogue by an
 * order of magnitude. Lifting the cap was not the fix: crawling all 1,007
 * categories ran past 13 minutes against a 240s per-brand timeout, because
 * categories overlap heavily and each one costs a round trip.
 *
 * `products(filter: { price: { from: "0" } })` returns the whole sellable
 * catalogue — 8,971 items over 90 pages — so the same coverage costs 90
 * requests rather than thousands, with no double-counting to dedupe.
 *
 * The retailer's own category label is the one casualty; it is now null, as it
 * already is for zara, penti, watsons, guess, sephora and pandora. Nothing
 * reads it — `product_type` is classified from the product NAME.
 *
 * Concurrency stays at 3, the value proven for Gratis. Rossmann is the brand
 * that IP-blocks, which is why it runs on its own box at all; there is no prize
 * for finding its limit.
 */
const PAGE_CONCURRENCY = Number(process.env.ROSSMANN_CONCURRENCY ?? 3);
/** A ceiling, not a target: 90 pages today, with room before it ever binds. */
const MAX_PAGES = Number(process.env.ROSSMANN_MAX_PAGES ?? 200);

function gql<T = any>(query: string): Promise<T> {
  return getJson<T>(GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    // Rossmann 403s GitHub's Azure ranges specifically — it answers 200 to a
    // residential IP, to GCP, and to a bare curl, so no header shaping helps.
    // `proxy: true` is a fallback (see getJson): the direct attempt still runs
    // first and costs nothing when it is not blocked.
    proxy: true,
    // From GitHub every page goes through rotating residential exits, and ~90
    // pages x 2 proxy tries lost the whole brand to one flaky exit on the first
    // run (2026-09-25, "fetch failed"). Five proxy tries per page makes a
    // brand-wide failure vanishingly rare; a direct 403 still costs ~nothing.
    retries: 6,
  });
}

/** Collect leaf categories (no children) that actually contain products. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Rossmann never puts its discounts in Magento's regular/final price — those are
 * always equal. Its deals live in custom attributes (priority order matches the
 * site's displayType()):
 *   1. crm_price      — "ROSSMANN Card ile": the LOYALTY-CARD price
 *   2. ross_60_price / special_price — a direct markdown, paid by everyone
 *   3. cmp_100/50/20_price — "N TL üzeri alışverişe": only with a basket over N TL
 *
 * Only (2) is a price a normal shopper pays at the shelf, so only (2) may become
 * `price`. This used to take crm_price first — sampled live 2026-09-25, 64 of
 * 100 products had a card price under the shelf price and not one had a direct
 * markdown, so ~85% of the brand's "deals" were card-only prices. Same rule as
 * Gratis's `promotionPrice` (the Gratis Kart price) and Watsons's MEMBER price.
 */
export function campaignPrice(p: any, base: number): number {
  const special = num(p?.ross_60_price) || num(p?.special_price);
  return special > 0 && special < base ? special : 0;
}

export function mapProduct(p: any, category: string | null): ProductRecord | null {
  const sku = String(p.sku ?? "");
  const min = p.price_range?.minimum_price ?? {};
  // GraphQL prices are major units (589 = ₺589,00), confirmed against the site.
  const regular: number | undefined = min.regular_price?.value;
  const final: number | undefined = min.final_price?.value ?? regular;
  if (!sku || !p.url_key || typeof final !== "number" || final <= 0) return null;
  const campaign = campaignPrice(p, final);
  const price = campaign > 0 ? campaign : final;
  const listPrice =
    campaign > 0 ? final : typeof regular === "number" && regular > final ? regular : null;
  // Single EAN per SKU here: Rossmann sells units, not sized garments, so
  // there is no per-size tag to worry about.
  const bc = String(p.barcode ?? "").replace(/\D/g, "");
  return {
    brand: "rossmann",
    externalId: sku,
    barcodes: bc.length >= 8 && bc.length <= 14 ? [bc] : null,
    name: p.name ?? "",
    url: `${SITE}/${p.url_key}`,
    imageUrl: p.small_image?.url ?? null,
    price: toMinor(price),
    listPrice: listPrice != null && listPrice > price ? toMinor(listPrice) : null,
    currency: "TRY",
    inStock: p.stock_status === "IN_STOCK",
    category,
  };
}

export const brand = "rossmann";

export async function listProducts(): Promise<ProductRecord[]> {
  const FIELDS = `sku barcode name url_key stock_status small_image { url }
    special_price ross_60_price
    price_range { minimum_price { regular_price { value } final_price { value } } }`;
  // `price from 0` matches everything sellable and is the only broad filter this
  // schema accepts — `sku like` is rejected outright.
  const ALL = `{ price: { from: "0" } }`;

  const first = await gql<any>(
    `{ products(filter: ${ALL}, pageSize: ${PAGE_SIZE}, currentPage: 1) {
        total_count page_info { total_pages } items { ${FIELDS} } } }`,
  );
  const info = first.data?.products;
  if (!info) return [];

  const byId = new Map<string, ProductRecord>();
  const take = (items: any[]) => {
    for (const p of items) {
      const rec = mapProduct(p, null);
      if (rec) byId.set(rec.externalId, rec);
    }
  };
  take(info.items ?? []);

  const totalPages = Math.min(info.page_info?.total_pages ?? 1, MAX_PAGES);
  let next = 2;
  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, Math.max(totalPages - 1, 1)) }, async () => {
      while (next <= totalPages) {
        const page = next++;
        const res = await gql<any>(
          `{ products(filter: ${ALL}, pageSize: ${PAGE_SIZE}, currentPage: ${page}) {
              items { ${FIELDS} } } }`,
        ).catch(() => null);
        // One bad page costs 100 products, not the run.
        if (res) take(res.data?.products?.items ?? []);
      }
    }),
  );
  return [...byId.values()];
}
