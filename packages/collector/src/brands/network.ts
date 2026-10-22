import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Network (Boyner group) — a custom ASP.NET + Vue storefront. The listing XHR
 * `/product/GetFilteredProductJson?categoryID=<id>&page=<n>` answers JSON with
 * price, strike price and per-size stock (`VariantWithStockList`) per row, so
 * no PDP calls are needed. The page size is fixed at 24 whatever is asked.
 *
 * FULL CATALOGUE (2026-10-19). Category 682 is the store root: 5,898 rows,
 * a superset of the outlet tree (930, 4,093 rows, every one reduced) and of
 * every main-line tree (kadın/erkek giyim, ayakkabı, aksesuar — 3 rows sit
 * only under the root). One walk returns everything in stock, discounted rows
 * with their strike price and full-price rows with `listPrice: null`, so the
 * collector's missing-product sweep sees the whole brand. The desktop UA gets
 * 48 rows a page: 123 requests, ~11s at concurrency 3 (measured from the Mac).
 */
export const SITE = "https://www.network.com.tr";
const ROOT_CATEGORY = 682;
const PAGE_SIZE = 24;
const CONCURRENCY = 3;
// Headroom over the 5,898-row / 123-page (295 at 20 a page) catalogue.
const MAX_PRODUCTS = Number(process.env.NETWORK_MAX_PRODUCTS ?? 20000);
const MAX_PAGES = Number(process.env.NETWORK_MAX_PAGES ?? 1000);

export const brand = "network";

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();
function genderOf(s: unknown): ProductRecord["gender"] {
  if (typeof s !== "string") return null;
  const t = fold(s);
  if (/cocuk/.test(t)) return "cocuk";
  if (/kadin/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return null;
}

/** mncdn resize template (`…/mnresize/{width}/{height}/productimages/x.jpg`) → a 600-wide rendition. */
function image(m: any): string | null {
  const f = m?.ProductMediaFileDOList?.[0];
  const t = f?.ImageResizePath;
  if (typeof t === "string" && t.includes("{width}")) return t.replace("{width}", "600").replace("{height}", "923");
  return typeof f?.UrlPath === "string" ? f.UrlPath : null;
}

/** `/ceket-p-229164` — the storefront's own product url shape. */
export const productUrl = (p: any) => `${SITE}/${p.FriendlyURI || "urun"}-p-${p.ID ?? p.ProductId}`;

/**
 * Map one listing row (also the shape of `/productv2/GetProductDetail`). Pure.
 * The id is the product `ID`, one per colour; `ExternalSystemCode` is
 * `<model>-<colour>`, so its model half is the explicit colour grouping.
 */
export function mapNetwork(p: any): ProductRecord | null {
  const id = p?.ID ?? p?.ProductId;
  const price = Number(p?.ActualPrice);
  if (id == null || !p?.DisplayName || !Number.isFinite(price) || price <= 0) return null;
  const strike = Number(p.StrikeThroughPriceToShowOnScreen);
  const media = [...(p.MediaList ?? [])].sort((a: any, b: any) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0));
  const first = image(p.FirstListingPageImage) ?? image(media[0]);
  const seen = new Set<string>();
  const sizes: SizeVariant[] = [];
  for (const v of p.VariantWithStockList ?? []) {
    const label = String(v?.ValueText ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    sizes.push({ label, availability: v.StockExists ? (v.HasLowStock ? "low_on_stock" : "in_stock") : "out_of_stock" });
  }
  const code = typeof p.ExternalSystemCode === "string" ? p.ExternalSystemCode : "";
  const model = code.match(/^([^-]+)-[^-]+$/)?.[1] ?? null;
  const colour = typeof p.Color === "string" && p.Color.trim() ? p.Color.trim() : null;
  return {
    brand,
    country: "TR",
    externalId: String(id),
    name: String(p.DisplayName).trim(),
    url: productUrl(p),
    imageUrl: first,
    images: cleanGallery(media.map(image), first),
    price: toMinor(price),
    listPrice: Number.isFinite(strike) && strike > price ? toMinor(strike) : null,
    currency: "TRY",
    inStock: sizes.length ? sizes.some((s) => s.availability !== "out_of_stock") : Number(p.QuantityInStock ?? 1) > 0,
    category: p.CategoryLevelDisplayName ?? null,
    gender: genderOf(p.Gender),
    variants: sizes.length ? { colors: colour ? [colour] : [], sizes } : null,
    groupKey: model,
    colorName: colour,
  };
}

const pageUrl = (n: number) =>
  `${SITE}/product/GetFilteredProductJson?categoryID=${ROOT_CATEGORY}&page=${n}` +
  `&dropListingPageSize=${PAGE_SIZE}&orderOption=NewProducts`;
const XHR = { "X-Requested-With": "XMLHttpRequest" };

/**
 * Imperva (Incapsula) sits in front of the site and rate-limits a datacenter
 * IP: after ~100 listing XHRs in a burst it answers 403 HTML, and keeps
 * refusing for as long as requests keep coming, then lets them through again
 * after a few quiet seconds (measured 2026-10-19 from a datacenter egress; the
 * runners lost pages 102-122 of 122 every run). Hammering retries through the
 * block is what kept it shut, so on any refusal every worker pauses for one
 * shared cooldown and the page goes back in the queue.
 */
const COOLDOWN_MS = Number(process.env.NETWORK_COOLDOWN_MS ?? 8000);
const MAX_COOLDOWNS = 12;

export interface WalkDeps {
  fetchPage?: (n: number) => Promise<any>;
  sleep?: (ms: number) => Promise<void>;
}

export const listProducts = (): Promise<ProductRecord[]> => walkCatalogue();

/** The listing walk, with the fetch and the clock injectable for tests. */
export async function walkCatalogue(deps: WalkDeps = {}): Promise<ProductRecord[]> {
  const fetchPage = deps.fetchPage ?? ((n: number) => getJson<any>(pageUrl(n), { headers: XHR, retries: 0 }));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const byId = new Map<string, ProductRecord>();
  const take = (data: any) => {
    for (const p of data?.Result?.ProductListItems ?? []) {
      const r = mapNetwork(p);
      if (r) byId.set(r.externalId, r);
    }
  };
  const page = (n: number) => fetchPage(n).catch(() => null);
  let first = await page(1);
  if (!first?.Result) {
    await sleep(COOLDOWN_MS);
    first = await page(1);
  }
  if (!first?.Result) throw new Error("network: first listing page carried no Result");
  take(first);
  const total = Number(first?.Result?.PaginationInfo?.TotalPageCount ?? 1);
  // A cap that cut pages would let the delist sweep mark their rows sold out: refuse instead.
  if (total > MAX_PAGES) throw new Error(`network: ${total} pages, over the cap of ${MAX_PAGES}`);
  const queue = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2);
  let cooldowns = 0;
  let pause: Promise<void> | null = null;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length && cooldowns <= MAX_COOLDOWNS) {
        if (pause) await pause;
        const n = queue.shift();
        if (n == null) break;
        const d = await page(n);
        if (d?.Result) {
          take(d);
          continue;
        }
        queue.push(n);
        if (!pause) {
          cooldowns++;
          pause = sleep(COOLDOWN_MS).then(() => {
            pause = null;
          });
        }
      }
    }),
  );
  // A lost page is 48 rows the collector would mark sold out: refuse a partial catalogue rather than return it.
  if (queue.length) throw new Error(`network: listing pages ${queue.sort((a, b) => a - b).join(",")} failed — partial catalogue refused`);
  if (byId.size > MAX_PRODUCTS) throw new Error(`network: ${byId.size} products, over the cap of ${MAX_PRODUCTS}`);
  return [...byId.values()];
}
