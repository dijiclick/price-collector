/**
 * Network by url (`network.com.tr/ceket-p-229164`). The `-p-<ID>` tail is the
 * product id the collector stores, and `/productv2/GetProductDetail?productId=`
 * answers the same row shape as the listing XHR (price, strike price, stock).
 */
import type { LiveProduct } from "../live-lookup";
import { UA, countryFor, json, toMinor } from "../live-http";

const SITE = "https://www.network.com.tr";

export function networkIdFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.toLowerCase().endsWith("network.com.tr")) return null;
  return u.pathname.match(/-p-(\d+)\/?$/)?.[1] ?? null;
}

const fold = (s: string) => s.replace(/[İI]/g, "i").replace(/ı/g, "i").replace(/[Çç]/g, "c").toLowerCase();
function genderOf(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = fold(s);
  if (/cocuk/.test(t)) return "cocuk";
  if (/kadin/.test(t)) return "kadin";
  if (/erkek/.test(t)) return "erkek";
  return null;
}

/** Map a GetProductDetail body. Pure. */
export function mapNetworkDetail(p: any): LiveProduct | null {
  const id = p?.ID ?? p?.ProductId;
  const price = Number(p?.ActualPrice);
  if (id == null || !p?.DisplayName || !Number.isFinite(price) || price <= 0) return null;
  const strike = Number(p.StrikeThroughPriceToShowOnScreen);
  const f = (p.FirstListingPageImage ?? p.MediaList?.[0])?.ProductMediaFileDOList?.[0];
  const tpl = f?.ImageResizePath;
  const imageUrl =
    typeof tpl === "string" && tpl.includes("{width}")
      ? tpl.replace("{width}", "600").replace("{height}", "923")
      : typeof f?.UrlPath === "string" ? f.UrlPath : null;
  const sizes: any[] = p.VariantWithStockList ?? [];
  return {
    brand: "network",
    externalId: String(id),
    name: String(p.DisplayName).trim(),
    url: `${SITE}/${p.FriendlyURI || "urun"}-p-${id}`,
    imageUrl,
    price: toMinor(price),
    listPrice: Number.isFinite(strike) && strike > price ? toMinor(strike) : null,
    inStock: sizes.length ? sizes.some((v) => v?.StockExists === true) : true,
    category: p.CategoryLevelDisplayName ?? null,
    type: null,
    gender: genderOf(p.Gender),
    colorName: typeof p.Color === "string" && p.Color.trim() ? p.Color.trim() : null,
    country: "TR",
    currency: "TRY",
  };
}

export async function networkUrl(url: string): Promise<LiveProduct | null> {
  const id = networkIdFromUrl(url);
  if (!id) return null;
  const body = await json<any>(
    `${SITE}/productv2/GetProductDetail?productId=${id}`,
    { Accept: "application/json", "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" },
    countryFor("network"),
  );
  return mapNetworkDetail(body);
}
