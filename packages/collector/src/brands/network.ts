import { cleanGallery, type ProductRecord, type SizeVariant } from "../types";
import { getJson } from "../http";
import { toMinor } from "../normalize";

/**
 * Network (Boyner group) — a custom ASP.NET + Vue storefront. The listing XHR
 * `/product/GetFilteredProductJson?categoryID=<id>&page=<n>` answers JSON with
 * price, strike price and per-size stock (`VariantWithStockList`) per row, so
 * no PDP calls are needed. The page size is fixed at 24 whatever is asked.
 *
 * The sale is the "Network Outlet" tree, category 930 (3,900 rows, every one
 * reduced, 2026-10-10). The full-price lines carry `Discount: 0`.
 */
export const SITE = "https://www.network.com.tr";
const OUTLET_CATEGORY = 930;
const PAGE_SIZE = 24;
const CONCURRENCY = 3;
const MAX_PRODUCTS = Number(process.env.NETWORK_MAX_PRODUCTS ?? 2000);
const MAX_PAGES = Number(process.env.NETWORK_MAX_PAGES ?? 90);

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
  `${SITE}/product/GetFilteredProductJson?categoryID=${OUTLET_CATEGORY}&page=${n}` +
  `&dropListingPageSize=${PAGE_SIZE}&orderOption=NewProducts`;
const XHR = { "X-Requested-With": "XMLHttpRequest" };

export async function listProducts(): Promise<ProductRecord[]> {
  const byId = new Map<string, ProductRecord>();
  const take = (data: any) => {
    for (const p of data?.Result?.ProductListItems ?? []) {
      const r = mapNetwork(p);
      if (r && r.listPrice != null && byId.size < MAX_PRODUCTS) byId.set(r.externalId, r);
    }
  };
  const first = await getJson<any>(pageUrl(1), { headers: XHR });
  take(first);
  const total = Math.min(Number(first?.Result?.PaginationInfo?.TotalPageCount ?? 1), MAX_PAGES);
  let next = 2;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next <= total && byId.size < MAX_PRODUCTS) {
        const n = next++;
        take(await getJson<any>(pageUrl(n), { headers: XHR }).catch(() => null));
      }
    }),
  );
  return [...byId.values()];
}
