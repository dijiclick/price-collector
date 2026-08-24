import type { ProductRecord, SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Pandora runs a Salesforce Commerce Cloud (SFCC) PWA Kit storefront. The
 * storefront proxies its API calls through `tr.pandora.net/mobify/proxy/*`,
 * which sits behind Cloudflare and 403s datacenter IPs — that path collected
 * nothing from CI for weeks. The same catalog is served by SCAPI on Salesforce's
 * own API host, which answers datacenter IPs with plain JSON, so we call that
 * directly and never touch the Cloudflare-fronted storefront except to mint a
 * token. Config below is what the storefront ships in its own `commerceAPI`
 * block on https://tr.pandora.net/tr/.
 */
const ORG = "f_ecom_bjrn_prd";
const SHORT_CODE = "s1mgwa5r";
const SITE_ID = "tr-TR";
const SCAPI = `https://${SHORT_CODE}.api.commercecloud.salesforce.com`;
const SITE = "https://tr.pandora.net";

/**
 * The SLAS client is *private*, so a token can't be minted from the SCAPI host
 * with just the public client id — it has to come from a storefront's
 * `/mobify/slas/private` proxy. Any Pandora storefront will issue a tr-TR
 * token, so keep a couple of alternates: if one region's edge blocks us, the
 * others still hand out a token that SCAPI accepts verbatim.
 */
const TOKEN_HOSTS = [SITE, "https://ie.pandora.net", "https://za.pandora.net"];

const PAGE_SIZE = 200;
const MAX_PAGES = Number(process.env.PANDORA_MAX_PAGES ?? 20);
/** SCAPI caps `ids` at 24 per request. */
const ID_BATCH = 24;
const DETAIL_CONCURRENCY = 4;

async function token(): Promise<string> {
  let lastErr: unknown = new Error("no token hosts configured");
  for (const host of TOKEN_HOSTS) {
    try {
      const res = await getJson<any>(
        `${host}/mobify/slas/private/shopper/auth/v1/organizations/${ORG}/oauth2/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=client_credentials&channel_id=${SITE_ID}`,
          retries: 0,
        },
      );
      if (res?.access_token) return res.access_token as string;
      lastErr = new Error(`no access_token in response from ${host}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * `salePrice` on this catalog always equals `originalPrice` — every product sits
 * in the single "regular" pricebook and the actual markdown is applied as a
 * promotion. Reading `salePrice` as the current price (as the first adapter did)
 * therefore reported *zero* discounts for the entire brand.
 *
 * The fix after that read `c_extend.priceInfo.promotionPrice`, but that field
 * does not exist in the response at all — verified against all 1637 products,
 * where `priceInfo` only ever carries `originalPrice` and `salePrice`. So the
 * brand still reported zero discounts, just via a different dead end.
 *
 * The markdown actually lives in `c_promoPrices`, a PER-VARIANT array
 * (`[{ pid, price, masterid }]`) where individual sizes go on promotion while
 * the master `price` stays at list. We take the cheapest purchasable variant,
 * which is both the real "you can pay this today" figure and what Pandora's own
 * listing shows. Note this means a markdown confined to one size surfaces as a
 * deal on the product — correct, and the size variants attached below tell the
 * user which size it is.
 */
function prices(hit: any): { price: number; listPrice: number | null } | null {
  const info = hit?.c_extend?.priceInfo ?? {};
  const original = info.originalPrice?.value ?? hit?.price;
  if (typeof original !== "number" || original <= 0) return null;
  const promos: number[] = (hit?.c_promoPrices ?? [])
    .map((p: any) => p?.price)
    .filter((v: any): v is number => typeof v === "number" && v > 0);
  const lowest = promos.length > 0 ? Math.min(...promos) : original;
  const current = lowest < original ? lowest : original;
  return {
    price: toMinor(current),
    listPrice: current < original ? toMinor(original) : null,
  };
}

export function mapHit(hit: any): ProductRecord | null {
  const id = String(hit?.productId ?? "");
  const p = id ? prices(hit) : null;
  if (!p) return null;
  return {
    brand: "pandora",
    externalId: id,
    name: hit.productName ?? "",
    url: hit.c_slugURL ?? `${SITE}/tr/${id}.html`,
    imageUrl: hit.image?.link ?? null,
    ...p,
    currency: "TRY",
    // `orderable` is true for every hit including sold-out ones; c_productInStock
    // is the flag that actually moves.
    inStock: hit.c_productInStock !== false,
    variants: null,
  };
}

/** Size labels + per-size availability, from the variation attribute matrix. */
function sizesOf(product: any): SizeVariant[] {
  const attr = (product?.variationAttributes ?? []).find((a: any) => a?.id === "size");
  const out: SizeVariant[] = [];
  const seen = new Set<string>();
  for (const v of attr?.values ?? []) {
    const label = String(v?.name ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, availability: v?.orderable ? "in_stock" : "out_of_stock" });
  }
  return out;
}

/** Run `fn` over `items` with a fixed number of workers. */
async function pool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * Attach sizes to the records that will actually surface as deals. The search
 * response carries only variant *ids*, so sizes need a second call; doing it for
 * the discounted subset keeps that to ~30 batched requests instead of ~75 for
 * the whole catalog.
 */
async function attachSizes(recs: ProductRecord[], auth: Record<string, string>): Promise<void> {
  const byId = new Map(recs.map((r) => [r.externalId, r]));
  const targets = recs.filter((r) => r.listPrice !== null).map((r) => r.externalId);
  const batches: string[][] = [];
  for (let i = 0; i < targets.length; i += ID_BATCH) batches.push(targets.slice(i, i + ID_BATCH));

  await pool(batches, DETAIL_CONCURRENCY, async (ids) => {
    const url =
      `${SCAPI}/product/shopper-products/v1/organizations/${ORG}/products` +
      `?siteId=${SITE_ID}&ids=${ids.join(",")}&expand=availability,variations`;
    // Best-effort: sizes are an enrichment, and the upsert coalesces a null onto
    // whatever is already stored, so a failure here must not lose the prices.
    const res = await getJson<any>(url, { headers: auth }).catch(() => null);
    for (const product of res?.data ?? []) {
      const rec = byId.get(String(product?.id ?? ""));
      if (!rec) continue;
      const sizes = sizesOf(product);
      if (sizes.length > 0) rec.variants = { colors: [], sizes };
      if (typeof product?.inventory?.orderable === "boolean") {
        rec.inStock = product.inventory.orderable;
      }
    }
  });
}

export const brand = "pandora";

export async function listProducts(): Promise<ProductRecord[]> {
  const auth = { Authorization: `Bearer ${await token()}` };
  const byId = new Map<string, ProductRecord>();
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url =
      `${SCAPI}/search/shopper-search/v1/organizations/${ORG}/product-search` +
      `?siteId=${SITE_ID}&refine=${encodeURIComponent("cgid=root")}` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    // A failure before we have anything is a real outage (block, bad token) —
    // let it throw so the run reports it instead of silently reporting an empty
    // catalog, which reads as "nothing on sale" and strands the brand's data.
    let res: any;
    try {
      res = await getJson<any>(url, { headers: auth });
    } catch (err) {
      if (byId.size === 0) throw err;
      break;
    }
    for (const hit of res?.hits ?? []) {
      const rec = mapHit(hit);
      if (rec) byId.set(rec.externalId, rec);
    }
    total = res?.total ?? 0;
    if (offset + PAGE_SIZE >= total) break;
  }

  const recs = [...byId.values()];
  await attachSizes(recs, auth);
  return recs;
}
