/**
 * Single-product lookup for SAP Commerce OCC v2 shops (Vakko `vsite`,
 * Vakkorama `rsite`). The product code is the `-p-<CODE>` tail of the url
 * (`…/ceket-p-M404335682-0037`), and `products/<CODE>?fields=FULL` answers
 * price, strike price and per-size stock with no auth. The collector stores the
 * same code as external_id, so a live answer lands on the same row.
 */
import type { LiveProduct } from "../live-lookup";
import { classifyType } from "../productTypes";
import { UA, countryFor, json, toMinor } from "../live-http";

export interface OccShop {
  brand: string;
  /** OCC base incl. site id, e.g. `https://api.vakko.com/occ/v2/vsite`. */
  api: string;
  /** Storefront origin, e.g. `https://www.vakko.com`. */
  web: string;
  /** The storefront's hostname, without `www.` — guards against the sister shop's urls. */
  host: string;
}

/** `-p-M404335682-0037` / `-p-M406723005-0021-0010` → the code. Null if the url is not this shop's PDP. */
export function occCodeFromUrl(url: string, host: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (h !== host) return null;
  return u.pathname.match(/.*-p-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\/?$/)?.[1]?.toUpperCase() ?? null;
}

const fold = (s: string) =>
  s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();
function genderOf(name: string): string | null {
  const t = fold(name);
  if (/cocuk|bebek/.test(t)) return "cocuk";
  if (/kadin/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return null;
}

/** `{x}/{y}` image template → 600×900. */
const img = (u: unknown): string | null =>
  typeof u === "string" && /^https?:\/\//.test(u) ? u.replace("{x}", "600").replace("{y}", "900") : null;

/** Map an OCC `products/<CODE>?fields=FULL` body. Pure. */
export function mapOccDetail(shop: Pick<OccShop, "brand" | "web">, d: any): LiveProduct | null {
  const code = typeof d?.code === "string" ? d.code : "";
  const name = String(d?.name ?? "").trim();
  const price = Number(d?.price?.value);
  if (!code || !name || !Number.isFinite(price) || price <= 0) return null;
  if (d.price?.currencyIso && d.price.currencyIso !== "TRY") return null;
  const strikes = [d.firstStrikePrice?.value, d.secondStrikePrice?.value]
    .map(Number).filter((v) => Number.isFinite(v) && v > price);
  const options: any[] = Array.isArray(d.variantOptions) ? d.variantOptions : [];
  const inStock = options.length
    ? options.some((o) => o?.isActive !== false && o?.stock?.stockLevelStatus && o.stock.stockLevelStatus !== "outOfStock")
    : !!d.stock?.stockLevelStatus && d.stock.stockLevelStatus !== "outOfStock";
  const cats: any[] = Array.isArray(d.categories) ? d.categories : [];
  const names = cats.map((c) => String(c?.name ?? "").trim()).filter(Boolean);
  const category = [...names].reverse().find((n) => !genderOf(n) && !/^outlet$/i.test(n)) ?? null;
  const primary = (Array.isArray(d.images) ? d.images : []).find((i: any) => i?.imageType === "PRIMARY");
  return {
    brand: shop.brand,
    externalId: code,
    name,
    url: typeof d.url === "string" && d.url.startsWith("/") ? `${shop.web}${d.url}` : shop.web,
    imageUrl: img(d.galleryImages?.[0]) ?? img(primary?.url),
    price: toMinor(price),
    listPrice: strikes.length ? toMinor(Math.max(...strikes)) : null,
    inStock,
    category,
    type: classifyType(category, name),
    gender: names.map(genderOf).find(Boolean) ?? null,
    colorName: d.productsCodes?.colorName ?? d.style ?? null,
    country: "TR",
    currency: "TRY",
  };
}

export async function occUrl(shop: OccShop, url: string): Promise<LiveProduct | null> {
  const code = occCodeFromUrl(url, shop.host);
  if (!code) return null;
  const d = await json<any>(
    `${shop.api}/products/${encodeURIComponent(code)}?fields=FULL&lang=tr&curr=TRY`,
    { Accept: "application/json", "User-Agent": UA },
    countryFor(shop.brand),
  );
  return d ? mapOccDetail(shop, d) : null;
}
